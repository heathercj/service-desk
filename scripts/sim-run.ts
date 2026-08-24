import "dotenv/config";
import { PrismaClient, type DepartmentKey, type RoleName } from "@prisma/client";
import { DEV_IDENTITIES } from "@/lib/dev-auth/dev-identities";
import {
  TRIAGE_PERSONA,
  DEPARTMENT_AGENT_PERSONAS,
  DEPARTMENT_MANAGER_PERSONAS,
  findDepartmentAgentPersona,
  findDepartmentManagerPersona,
  type AgentPersona,
} from "@/lib/simulation/agent-personas";
import {
  CUSTOMER_PERSONAS,
  findCustomerPersona,
} from "@/lib/simulation/customer-personas";
import {
  createRng,
  pickScenario,
  buildDiagnosticNote,
  buildResolutionMessage,
  buildEscalationNote,
  buildEscalationMessage,
  buildCustomerFollowUp,
  buildReopenReason,
  buildCustomerReflection,
  buildStaffReflection,
  decideOutcome,
  decideReopen,
} from "@/lib/simulation/response-engine";
import { buildScorecard, type TicketRunRecord } from "@/lib/simulation/scorecard";
import { buildTeamDiscussion } from "@/lib/simulation/discussion";
import {
  simCreateTicket,
  simConfirmTriage,
  simSelfAssignTicket,
  simReassignTicket,
  simTransitionTicketStatus,
  simAddConversationMessage,
  simAddInternalNote,
  simResolveTicket,
  simRecordSimilarityCheck,
  simRecordKnowledgeOutcome,
  type SimActor,
} from "@/lib/simulation/sim-ticket-ops";

/**
 * Local, deterministic QA simulation harness (see
 * C:\Users\HeatherCapperJones\.claude\plans\glittery-swimming-leaf.md).
 * Drives synthetic tickets through the real ticket lifecycle -- state
 * machine, RBAC, resolution gate -- using scripted personas instead of a
 * real person. No LLM/network call anywhere. Usage:
 *
 *   pnpm sim:run --count=5 --seed=1 [--customer=<persona-key>]
 */

const db = new PrismaClient();
const DEV_TENANT_ID =
  process.env.ENTRA_TENANT_ID || "00000000-0000-0000-0000-000000000000";

function simEntraObjectId(personaKey: string): string {
  return `sim::${personaKey}`;
}

interface SimOptions {
  count: number;
  seed: number;
  customerKey?: string;
}

function parseArgs(argv: string[]): SimOptions {
  const opts: SimOptions = { count: 5, seed: 1 };
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!match) continue;
    const [, flag, value] = match;
    if (flag === "count") opts.count = Number(value);
    if (flag === "seed") opts.seed = Number(value);
    if (flag === "customer") opts.customerKey = value;
  }
  return opts;
}

async function assignRole(userId: string, name: RoleName) {
  const role = await db.role.findUniqueOrThrow({ where: { name } });
  await db.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
}

async function assignDepartment(userId: string, key: DepartmentKey, isManager: boolean) {
  const dept = await db.department.findUniqueOrThrow({ where: { key } });
  await db.departmentMembership.upsert({
    where: { userId_departmentId: { userId, departmentId: dept.id } },
    create: { userId, departmentId: dept.id, isManager },
    update: { isManager },
  });
}

async function upsertSimUser(persona: {
  key: string;
  displayName: string;
  email: string;
}) {
  const entraObjectId = simEntraObjectId(persona.key);
  return db.user.upsert({
    where: { entraObjectId },
    create: {
      entraObjectId,
      entraTenantId: DEV_TENANT_ID,
      email: persona.email,
      displayName: persona.displayName,
      isDevAccount: true,
    },
    update: { email: persona.email, displayName: persona.displayName },
  });
}

/** Idempotent: safe to run every time, never touches DEV_IDENTITIES/dev-auth. */
async function ensureSimulationUsers(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  const triageUser = await upsertSimUser(TRIAGE_PERSONA);
  await assignRole(triageUser.id, "TRIAGE_AGENT");
  ids[TRIAGE_PERSONA.key] = triageUser.id;

  for (const persona of [...DEPARTMENT_AGENT_PERSONAS, ...DEPARTMENT_MANAGER_PERSONAS]) {
    const user = await upsertSimUser(persona);
    await assignRole(user.id, persona.roleName);
    if (persona.departmentKey) {
      await assignDepartment(user.id, persona.departmentKey, Boolean(persona.isManager));
    }
    ids[persona.key] = user.id;
  }

  for (const persona of CUSTOMER_PERSONAS) {
    const user = await upsertSimUser(persona);
    await assignRole(user.id, "CUSTOMER");
    ids[persona.key] = user.id;
  }

  // The knowledge gate (Section 11.3) requires a Knowledge Manager to record
  // an EXCEPTION outcome for departments with no matching published article.
  // Reuse the existing "knowledge-manager" dev identity definition (Kai
  // Knowledge) rather than inventing a 7th persona for a supporting role --
  // this upserts the same row prisma/seed.ts would, so it works whether or
  // not seed.ts has been run in this environment.
  const kmIdentity = DEV_IDENTITIES.find(
    (identity) => identity.key === "knowledge-manager",
  );
  if (kmIdentity) {
    const kmUser = await db.user.upsert({
      where: { entraObjectId: kmIdentity.entraObjectId },
      create: {
        entraObjectId: kmIdentity.entraObjectId,
        entraTenantId: DEV_TENANT_ID,
        email: kmIdentity.email,
        displayName: kmIdentity.displayName,
        isDevAccount: true,
      },
      update: {},
    });
    await assignRole(kmUser.id, "KNOWLEDGE_MANAGER");
    ids[kmIdentity.key] = kmUser.id;
  }

  return ids;
}

async function buildActor(userId: string): Promise<SimActor> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: { include: { role: true } }, departmentMemberships: true },
  });
  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    roles: new Set(user.roles.map((r) => r.role.name)),
    departments: new Map(
      user.departmentMemberships.map((m) => [m.departmentId, m.isManager]),
    ),
  };
}

function requireId(ids: Record<string, string>, key: string): string {
  const id = ids[key];
  if (!id) throw new Error(`No simulation user id for persona key "${key}"`);
  return id;
}

async function findPublishedArticle(departmentId: string) {
  return db.knowledgeArticle.findFirst({
    where: { departmentId, status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
  });
}

async function assertSeeded() {
  const [roles, departments, franchises] = await Promise.all([
    db.role.count(),
    db.department.count(),
    db.franchise.count(),
  ]);
  if (roles === 0 || departments === 0 || franchises === 0) {
    throw new Error(
      "Roles/departments/franchises are missing -- run `pnpm db:seed` before `pnpm sim:run`.",
    );
  }
}

interface TicketRunResult {
  transcript: string;
  record: TicketRunRecord;
}

async function runOneTicket(
  ids: Record<string, string>,
  rng: () => number,
  opts: SimOptions,
  index: number,
  franchiseId: string,
): Promise<TicketRunResult> {
  const randomIndex = Math.min(
    Math.floor(rng() * CUSTOMER_PERSONAS.length),
    CUSTOMER_PERSONAS.length - 1,
  );
  const customerKey = opts.customerKey ?? CUSTOMER_PERSONAS[randomIndex]?.key;
  if (!customerKey) throw new Error("No customer persona available");
  const customer = findCustomerPersona(customerKey);
  const scenario = pickScenario(customer, rng);

  const customerActor = await buildActor(requireId(ids, customer.key));
  const triageActor = await buildActor(requireId(ids, TRIAGE_PERSONA.key));

  const transcript: string[] = [`\n=== Ticket ${index + 1}: ${scenario.subject} ===`];
  transcript.push(
    `Customer persona: ${customer.displayName} (${customer.skills.join("; ")})`,
  );

  let ticket = await simCreateTicket(db, customerActor, {
    franchiseId,
    subject: scenario.subject,
    description: scenario.description,
    departmentKey: scenario.departmentKey,
  });
  transcript.push(
    `[${ticket.ticketNumber}] SUBMITTED by ${customer.displayName}: "${scenario.description}"`,
  );

  ticket = await simConfirmTriage(db, triageActor, {
    ticketId: ticket.id,
    version: ticket.version,
    departmentKey: scenario.departmentKey,
    category: scenario.category,
    priority: scenario.priority,
  });
  transcript.push(
    `Triage (${TRIAGE_PERSONA.displayName}) routed to ${scenario.departmentKey}, priority ${scenario.priority} -> QUEUED`,
  );

  const agentPersona = findDepartmentAgentPersona(scenario.departmentKey);
  const agentActor = await buildActor(requireId(ids, agentPersona.key));

  ticket = await simSelfAssignTicket(db, agentActor, ticket.id, ticket.version);
  transcript.push(`${agentPersona.displayName} self-assigned -> ASSIGNED`);

  ticket = await simTransitionTicketStatus(db, agentActor, {
    ticketId: ticket.id,
    version: ticket.version,
    toStatus: "IN_PROGRESS",
  });
  transcript.push(`${agentPersona.displayName} started work -> IN_PROGRESS`);

  const diagnosticNote = buildDiagnosticNote(agentPersona, scenario);
  await simAddInternalNote(db, agentActor, ticket.id, diagnosticNote);
  transcript.push(`[internal note] ${agentPersona.displayName}: ${diagnosticNote}`);

  const resolutionMessage = buildResolutionMessage(agentPersona, scenario);
  let msgResult = await simAddConversationMessage(db, agentActor, {
    ticketId: ticket.id,
    version: ticket.version,
    body: resolutionMessage,
  });
  ticket = msgResult.ticket;
  transcript.push(`${agentPersona.displayName}: ${resolutionMessage}`);

  let resolvingActor = agentActor;
  let resolvingPersona: AgentPersona = agentPersona;
  let round = 1;
  let completedRounds = 0;
  let escalated = false;
  let outcome = decideOutcome(customer, rng, round);

  while (outcome === "follow_up" && round <= 2) {
    ticket = await simTransitionTicketStatus(db, resolvingActor, {
      ticketId: ticket.id,
      version: ticket.version,
      toStatus: "WAITING_FOR_CUSTOMER",
    });

    const followUp = buildCustomerFollowUp(customer, round);
    msgResult = await simAddConversationMessage(db, customerActor, {
      ticketId: ticket.id,
      version: ticket.version,
      body: followUp,
    });
    ticket = msgResult.ticket;
    transcript.push(`${customer.displayName}: ${followUp}`);

    const followUpReply = buildResolutionMessage(resolvingPersona, scenario);
    msgResult = await simAddConversationMessage(db, resolvingActor, {
      ticketId: ticket.id,
      version: ticket.version,
      body: followUpReply,
    });
    ticket = msgResult.ticket;
    transcript.push(`${resolvingPersona.displayName}: ${followUpReply}`);

    round += 1;
    completedRounds += 1;
    outcome = decideOutcome(customer, rng, round);
  }

  if (outcome === "escalate") {
    escalated = true;
    const managerPersona = findDepartmentManagerPersona(scenario.departmentKey);
    const managerActor = await buildActor(requireId(ids, managerPersona.key));

    ticket = await simReassignTicket(
      db,
      managerActor,
      ticket.id,
      ticket.version,
      managerActor.userId,
    );
    transcript.push(`Escalated to ${managerPersona.displayName}`);

    const escalationNote = buildEscalationNote(managerPersona, scenario);
    await simAddInternalNote(db, managerActor, ticket.id, escalationNote);
    transcript.push(`[internal note] ${managerPersona.displayName}: ${escalationNote}`);

    const escalationMessage = buildEscalationMessage(managerPersona);
    msgResult = await simAddConversationMessage(db, managerActor, {
      ticketId: ticket.id,
      version: ticket.version,
      body: escalationMessage,
    });
    ticket = msgResult.ticket;
    transcript.push(`${managerPersona.displayName}: ${escalationMessage}`);

    resolvingActor = managerActor;
    resolvingPersona = managerPersona;
  }

  const resolveResult = await simResolveTicket(db, resolvingActor, {
    ticketId: ticket.id,
    version: ticket.version,
    resolutionSummary: `Resolved "${scenario.subject}" using ${resolvingPersona.skills[0]}.`,
    resolutionSteps: buildResolutionMessage(resolvingPersona, scenario),
  });
  ticket = resolveResult.ticket;
  transcript.push(
    `${resolvingPersona.displayName} submitted resolution -> ${ticket.status}`,
  );

  let knowledgeOutcomeType: TicketRunRecord["knowledgeOutcomeType"] = "LINKED_EXISTING";

  if (ticket.status === "RESOLUTION_REVIEW") {
    const candidateArticle = await findPublishedArticle(ticket.departmentId);

    await simRecordSimilarityCheck(db, {
      ticketId: ticket.id,
      performedById: resolvingActor.userId,
      normalizedQuery: scenario.subject.toLowerCase(),
      candidateArticleIds: candidateArticle ? [candidateArticle.id] : [],
    });

    if (candidateArticle) {
      const outcomeResult = await simRecordKnowledgeOutcome(db, resolvingActor, {
        ticketId: ticket.id,
        articleId: candidateArticle.id,
        outcomeType: "LINKED_EXISTING",
      });
      ticket = outcomeResult.gateResult.ticket;
      transcript.push(
        `${resolvingPersona.displayName} linked knowledge article "${candidateArticle.title}" -> ${ticket.status}`,
      );
    } else {
      knowledgeOutcomeType = "EXCEPTION";
      const kmActor = await buildActor(requireId(ids, "knowledge-manager"));
      const outcomeResult = await simRecordKnowledgeOutcome(db, kmActor, {
        ticketId: ticket.id,
        outcomeType: "EXCEPTION",
        reason:
          "No relevant knowledge article exists yet for this department; approved as a one-off resolution for this simulation.",
      });
      ticket = outcomeResult.gateResult.ticket;
      transcript.push(
        `${kmActor.displayName} recorded a knowledge exception -> ${ticket.status}`,
      );
    }
  }

  let reopened = false;
  if (ticket.status === "RESOLVED" && decideReopen(customer, rng)) {
    reopened = true;
    const reason = buildReopenReason(customer, scenario);
    ticket = await simTransitionTicketStatus(db, customerActor, {
      ticketId: ticket.id,
      version: ticket.version,
      toStatus: "REOPENED",
      reason,
    });
    transcript.push(`${customer.displayName} reopened the ticket: ${reason}`);
  }

  transcript.push(`Final status: ${ticket.status}`);

  const record: TicketRunRecord = {
    customerKey: customer.key,
    customerDisplayName: customer.displayName,
    resolvingPersonaKey: resolvingPersona.key,
    resolvingPersonaDisplayName: resolvingPersona.displayName,
    rounds: completedRounds,
    escalated,
    knowledgeOutcomeType,
    reopened,
    finalStatus: ticket.status,
  };

  transcript.push(buildCustomerReflection(customer, record));
  transcript.push(buildStaffReflection(resolvingPersona, record));

  return { transcript: transcript.join("\n"), record };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `sim-run: count=${opts.count} seed=${opts.seed}${opts.customerKey ? ` customer=${opts.customerKey}` : ""}`,
  );

  await assertSeeded();

  const franchise = await db.franchise.findFirst({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  if (!franchise)
    throw new Error("No active franchise found -- run `pnpm db:seed` first.");

  const ids = await ensureSimulationUsers();
  console.log(`Ensured ${Object.keys(ids).length} simulation persona users.`);

  const rng = createRng(opts.seed);
  const records: TicketRunRecord[] = [];
  for (let i = 0; i < opts.count; i++) {
    const { transcript, record } = await runOneTicket(ids, rng, opts, i, franchise.id);
    console.log(transcript);
    records.push(record);
  }

  console.log(buildScorecard(records));
  console.log(buildTeamDiscussion(records));
}

main()
  .catch((err) => {
    console.error("sim-run: failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
