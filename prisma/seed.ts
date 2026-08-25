import "dotenv/config";
import {
  PrismaClient,
  type RoleName,
  type DepartmentKey,
  type TicketStatus,
} from "@prisma/client";
import { DEV_IDENTITIES } from "../src/lib/dev-auth/dev-identities";
import { writeArticleFile } from "../src/lib/knowledge/markdown-repo";
import type { KnowledgeFrontMatter } from "../src/lib/knowledge/front-matter-schema";

const db = new PrismaClient();

const DEV_TENANT_ID =
  process.env.ENTRA_TENANT_ID || "00000000-0000-0000-0000-000000000000";

const DEPARTMENTS: Array<{ key: DepartmentKey; name: string }> = [
  { key: "TECHNOLOGY_SUPPORT", name: "Technology Support" },
  { key: "TRAINING", name: "Training" },
  { key: "ACCOUNTING_SERVICES", name: "Accounting Services" },
  { key: "MARKETING", name: "Marketing" },
  { key: "LEGAL", name: "Legal" },
  { key: "IMPROVEMENT_IDEAS", name: "Improvement Ideas" },
];

const ROLE_NAMES: RoleName[] = [
  "CUSTOMER",
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "ADMINISTRATOR",
];

const FRANCHISES = [
  { code: "VAN", name: "Alair Homes Vancouver" },
  { code: "CAL", name: "Alair Homes Calgary" },
  { code: "TOR", name: "Alair Homes Toronto" },
  // Fallback for ticket intake (web and email) when the submitter's Entra
  // department value doesn't match a real franchise -- see
  // src/lib/tickets/franchise-lookup.ts. Triage can correct it afterward.
  { code: "HQ", name: "Head Office / Unassigned" },
];

async function seedRolesAndDepartments() {
  for (const name of ROLE_NAMES) {
    await db.role.upsert({ where: { name }, create: { name }, update: {} });
  }
  for (const dept of DEPARTMENTS) {
    await db.department.upsert({
      where: { key: dept.key },
      create: dept,
      update: { name: dept.name },
    });
  }
  console.log(`Seeded ${ROLE_NAMES.length} roles and ${DEPARTMENTS.length} departments.`);
}

async function seedFranchises() {
  for (const f of FRANCHISES) {
    await db.franchise.upsert({
      where: { code: f.code },
      create: f,
      update: { name: f.name },
    });
  }
  console.log(`Seeded ${FRANCHISES.length} franchises.`);
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

async function seedDevIdentities(): Promise<Record<string, string>> {
  const idByKey: Record<string, string> = {};

  for (const identity of DEV_IDENTITIES) {
    const user = await db.user.upsert({
      where: { entraObjectId: identity.entraObjectId },
      create: {
        // Reuse the fixed fake object id as the primary key. Dev identities
        // are the only accounts the seed creates, and a stable id keeps the
        // committed knowledge-base files from churning: their front matter
        // records `createdBy`, so a random uuid per reset showed up as a
        // dirty working tree after every `pnpm db:reset`.
        id: identity.entraObjectId,
        entraObjectId: identity.entraObjectId,
        entraTenantId: DEV_TENANT_ID,
        email: identity.email,
        displayName: identity.displayName,
        isDevAccount: true,
      },
      update: { email: identity.email, displayName: identity.displayName },
    });
    idByKey[identity.key] = user.id;

    for (const role of identity.roles) {
      await assignRole(user.id, role);
    }
    for (const deptKey of identity.departmentKeys ?? []) {
      const isManager = identity.managerOf?.includes(deptKey) ?? false;
      await assignDepartment(user.id, deptKey, isManager);
    }
  }

  console.log(`Seeded ${DEV_IDENTITIES.length} development identities.`);
  return idByKey;
}

/**
 * Fixed rather than "today": these articles are written to files that are in
 * version control, so a date derived from the clock made every re-seed on a
 * new day look like an edit. It also reads better in the demo -- the seeded
 * help pages are supposed to predate the ticket being walked through.
 */
const SEED_ARTICLE_DATE = "2026-06-01";

interface SeedArticleInput {
  title: string;
  summary: string;
  departmentKey: DepartmentKey;
  tags: string[];
  status: "draft" | "in_review" | "published" | "archived";
  createdById: string;
  body: string;
}

async function seedArticle(input: SeedArticleInput) {
  const dept = await db.department.findUniqueOrThrow({
    where: { key: input.departmentKey },
  });
  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
  const articleKey = `KB-SEED-${slug.slice(0, 20)}`;

  const frontMatter: KnowledgeFrontMatter = {
    id: articleKey,
    title: input.title,
    slug,
    summary: input.summary,
    department: input.departmentKey,
    status: input.status,
    internalOnly: false,
    tags: input.tags,
    createdDate: SEED_ARTICLE_DATE,
    updatedDate: SEED_ARTICLE_DATE,
    createdBy: input.createdById,
    revision: 1,
    sourceTicketIds: [],
  };

  const file = await writeArticleFile(input.departmentKey, slug, frontMatter, input.body);

  const dbStatus = input.status.toUpperCase() as
    | "DRAFT"
    | "IN_REVIEW"
    | "PUBLISHED"
    | "ARCHIVED";

  const article = await db.knowledgeArticle.upsert({
    where: { departmentId_slug: { departmentId: dept.id, slug } },
    create: {
      articleKey,
      slug,
      departmentId: dept.id,
      title: input.title,
      summary: input.summary,
      status: dbStatus,
      filePath: file.relativePath,
      contentHash: file.contentHash,
      revision: 1,
      createdById: input.createdById,
      createdAt: new Date(`${SEED_ARTICLE_DATE}T09:00:00Z`),
      publishedAt:
        dbStatus === "PUBLISHED" ? new Date(`${SEED_ARTICLE_DATE}T09:00:00Z`) : null,
      archivedAt:
        dbStatus === "ARCHIVED" ? new Date(`${SEED_ARTICLE_DATE}T09:00:00Z`) : null,
    },
    update: { status: dbStatus, contentHash: file.contentHash },
  });

  for (const name of input.tags) {
    const tag = await db.tag.upsert({ where: { name }, create: { name }, update: {} });
    await db.knowledgeArticleTag
      .upsert({
        where: { articleId_tagId: { articleId: article.id, tagId: tag.id } },
        create: { articleId: article.id, tagId: tag.id },
        update: {},
      })
      .catch(() => undefined);
  }

  await db.knowledgeArticleRevision.upsert({
    where: { articleId_revision: { articleId: article.id, revision: 1 } },
    create: {
      articleId: article.id,
      revision: 1,
      contentSnapshot: input.body,
      editedById: input.createdById,
      changeSummary: "Seed data",
    },
    update: {},
  });

  return article;
}

async function seedKnowledgeBase(ids: Record<string, string>) {
  const km = ids["knowledge-manager"]!;
  const agent = ids["dept-agent"]!;

  await seedArticle({
    title: "Resetting your VPN client",
    summary:
      "Steps to clear cached credentials and reconnect when the VPN client won't authenticate.",
    departmentKey: "TECHNOLOGY_SUPPORT",
    tags: ["vpn", "network", "login"],
    status: "published",
    createdById: agent,
    body: `## Symptoms\n\nThe VPN client shows "authentication failed" or spins indefinitely when connecting.\n\n## Resolution\n\n1. Sign out of the VPN client completely.\n2. Clear the cached credential profile (Settings > Accounts > Forget this device).\n3. Reinstall the connection profile from the company portal.\n4. Reconnect and sign in again.\n\n## Verification\n\nConfirm you can reach an internal-only resource (e.g. the intranet home page).`,
  });

  await seedArticle({
    title: "Connecting to office Wi-Fi",
    summary: "How to join the corporate Wi-Fi network from a new or reimaged laptop.",
    departmentKey: "TECHNOLOGY_SUPPORT",
    tags: ["wifi", "network"],
    status: "published",
    createdById: agent,
    body: `## Resolution\n\n1. Select the "Alair-Corp" network.\n2. Sign in with your normal work credentials.\n3. Accept the certificate prompt on first connection.\n\nIf the certificate prompt does not appear, restart the laptop's Wi-Fi adapter and try again.`,
  });

  await seedArticle({
    title: "Enrolling in the onboarding course",
    summary:
      "How new hires and franchise partners enroll in the mandatory onboarding curriculum.",
    departmentKey: "TRAINING",
    tags: ["onboarding", "course"],
    status: "published",
    createdById: km,
    body: `## Resolution\n\n1. Sign in to the Learning Portal with your work account.\n2. Search for "Onboarding 101".\n3. Click Enroll, then complete all four modules in order.\n\nCompletion is automatically reported to your manager.`,
  });

  await seedArticle({
    title: "Submitting an expense reimbursement",
    summary:
      "The correct process for submitting receipts for reimbursement through Accounting Services.",
    departmentKey: "ACCOUNTING_SERVICES",
    tags: ["expense", "reimbursement"],
    status: "published",
    createdById: ids["accounting-agent"]!,
    body: `## Resolution\n\n1. Scan or photograph each receipt clearly.\n2. Submit through the Expense Portal within 30 days of purchase.\n3. Tag the correct project number if the expense is project-related.\n\nReimbursements are processed on the next bi-weekly pay cycle.`,
  });

  await seedArticle({
    title: "Printer offline troubleshooting",
    summary:
      "Draft steps for bringing a printer back online after it reports an offline status.",
    departmentKey: "TECHNOLOGY_SUPPORT",
    tags: ["printer"],
    status: "draft",
    createdById: agent,
    body: `## Draft resolution\n\n1. Confirm the printer has power and a network light.\n2. Remove and re-add the printer queue.\n\n_Needs review before publishing._`,
  });

  await seedArticle({
    title: "Legacy certification process",
    summary:
      "The old certification process, superseded by the current onboarding course.",
    departmentKey: "TRAINING",
    tags: ["certification", "legacy"],
    status: "archived",
    createdById: km,
    body: `## Note\n\nThis process has been superseded by "Enrolling in the onboarding course". Retained for historical reference only.`,
  });

  console.log("Seeded 6 knowledge articles (4 published, 1 draft, 1 archived).");
}

interface SeedTicketInput {
  subject: string;
  description: string;
  status: TicketStatus;
  /**
   * How long ago this ticket was raised. Everything else about the ticket --
   * its number, its status changes, its messages -- is derived from this, so
   * a seeded desk reads like one that has been running for a week rather than
   * eleven tickets filed in the same second.
   */
  ageHours: number;
  departmentKey: DepartmentKey;
  submittedById: string;
  franchiseCode: string;
  assigneeId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  isProjectRelated?: boolean;
  projectNumber?: string;
  urls?: string[];
  resolutionSummary?: string;
  resolutionSteps?: string;
  withInternalNote?: string;
  withCustomerMessage?: string;
}

/**
 * Where seeded ticket numbers start. High enough that the desk reads as one
 * with history behind it rather than one opened this morning.
 */
const TICKET_NUMBER_BASE = 1000;

/** One clock for the whole seed run, so a ticket's own timeline stays ordered. */
const SEED_NOW = Date.now();
const hoursAgo = (hours: number) => new Date(SEED_NOW - hours * 3_600_000);

async function seedTicket(
  ids: Record<string, string>,
  counterStart: number,
  input: SeedTicketInput,
  index: number,
) {
  const submitter = await db.user.findUniqueOrThrow({
    where: { id: input.submittedById },
  });
  const franchise = await db.franchise.findUniqueOrThrow({
    where: { code: input.franchiseCode },
  });
  const dept = await db.department.findUniqueOrThrow({
    where: { key: input.departmentKey },
  });

  const ticketNumber = `SD-${String(counterStart + index).padStart(6, "0")}`;

  const existing = await db.ticket.findUnique({ where: { ticketNumber } });
  if (existing) return existing;

  // A plausible internal timeline: raised, then picked up partway through its
  // life, then resolved and closed after that. Fractions of the age rather
  // than fixed offsets so a three-hour-old ticket does not get a two-day
  // resolution.
  const createdAt = hoursAgo(input.ageHours);
  const statusChangedAt = hoursAgo(input.ageHours * 0.55);
  const customerMessageAt = hoursAgo(input.ageHours * 0.75);
  const internalNoteAt = hoursAgo(input.ageHours * 0.5);
  const resolvedAt = hoursAgo(input.ageHours * 0.3);
  const closedAt = hoursAgo(input.ageHours * 0.15);
  const isDone = input.status === "RESOLVED" || input.status === "CLOSED";

  const ticket = await db.ticket.create({
    data: {
      ticketNumber,
      submittedById: submitter.id,
      submittedName: submitter.displayName,
      submittedEmail: submitter.email,
      franchiseId: franchise.id,
      subject: input.subject,
      description: input.description,
      submittedDepartmentId: dept.id,
      departmentId: dept.id,
      status: input.status,
      priority: input.priority ?? "MEDIUM",
      assigneeId: input.assigneeId,
      isProjectRelated: input.isProjectRelated ?? false,
      projectNumber: input.projectNumber,
      resolutionSummary: input.resolutionSummary,
      resolutionSteps: input.resolutionSteps,
      resolutionEnteredAt: input.resolutionSummary ? resolvedAt : null,
      resolvedAt: isDone ? resolvedAt : null,
      resolvedById: isDone ? input.assigneeId : null,
      closedAt: input.status === "CLOSED" ? closedAt : null,
      createdAt,
      updatedAt: input.status === "CLOSED" ? closedAt : statusChangedAt,
    },
  });

  if (input.urls?.length) {
    await db.ticketUrl.createMany({
      data: input.urls.map((url) => ({
        ticketId: ticket.id,
        url,
        hostname: new URL(url).hostname,
      })),
    });
  }

  await db.ticketStatusHistory.create({
    data: {
      ticketId: ticket.id,
      fromStatus: null,
      toStatus: "SUBMITTED",
      changedById: submitter.id,
      createdAt,
    },
  });
  if (input.status !== "SUBMITTED") {
    await db.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: "SUBMITTED",
        toStatus: input.status,
        changedById: input.assigneeId ?? submitter.id,
        createdAt: statusChangedAt,
      },
    });
  }

  if (input.withCustomerMessage) {
    await db.conversationMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: submitter.id,
        isFromCustomer: true,
        body: input.withCustomerMessage,
        createdAt: customerMessageAt,
      },
    });
  }
  if (input.withInternalNote && input.assigneeId) {
    await db.internalNote.create({
      data: {
        ticketId: ticket.id,
        authorId: input.assigneeId,
        body: input.withInternalNote,
        createdAt: internalNoteAt,
      },
    });
  }

  return ticket;
}

async function seedTickets(ids: Record<string, string>) {
  const customer = ids["customer"]!;
  const customer2 = ids["customer2"]!;
  const agent = ids["dept-agent"]!;
  const manager = ids["dept-manager"]!;

  const tickets: SeedTicketInput[] = [
    {
      subject: "Cannot connect to VPN from home",
      ageHours: 3,
      description:
        "My VPN client fails to authenticate whenever I try to connect from my home network. It worked fine last week.",
      status: "SUBMITTED",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer,
      franchiseCode: "VAN",
      priority: "MEDIUM",
      isProjectRelated: true,
      projectNumber: "2026-0142",
      urls: ["https://intranet.example.test/status/vpn"],
    },
    {
      subject: "New laptop needs onboarding software",
      ageHours: 7,
      description:
        "I received a new laptop for a franchise project and need the standard software bundle installed before I can start work next week.",
      status: "IN_TRIAGE",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer2,
      franchiseCode: "CAL",
      priority: "MEDIUM",
    },
    {
      subject: "Need access to onboarding course",
      ageHours: 19,
      description:
        "I was added as a new project manager and cannot find the onboarding course in the learning portal.",
      status: "QUEUED",
      departmentKey: "TRAINING",
      submittedById: customer,
      franchiseCode: "VAN",
      priority: "LOW",
    },
    {
      subject: "Printer in site office shows offline",
      ageHours: 27,
      description:
        "The printer at the Calgary site office has shown offline for two days and we cannot print change orders for the client.",
      status: "ASSIGNED",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer2,
      franchiseCode: "CAL",
      assigneeId: agent,
      priority: "HIGH",
    },
    {
      subject: "Outlook keeps prompting for password",
      ageHours: 44,
      description:
        "Outlook repeatedly asks me to re-enter my password every few minutes, even though the password is correct each time.",
      status: "IN_PROGRESS",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer,
      franchiseCode: "VAN",
      assigneeId: agent,
      priority: "MEDIUM",
      withCustomerMessage:
        "This has been happening since yesterday morning, it's slowing me down a lot.",
      withInternalNote:
        "Checked account lockout policy -- looks like a cached-credential issue, testing a fix.",
    },
    {
      subject: "Need clarification on expense receipt format",
      ageHours: 51,
      description:
        "I submitted receipts for a project trip but I'm not sure which project number to tag them with. Can someone confirm the process?",
      status: "WAITING_FOR_CUSTOMER",
      departmentKey: "ACCOUNTING_SERVICES",
      submittedById: customer,
      franchiseCode: "VAN",
      assigneeId: ids["accounting-agent"],
      priority: "LOW",
      withCustomerMessage:
        "Could you confirm which project number applies to shared site-visit travel costs?",
    },
    {
      subject: "Wi-Fi drops constantly in the Toronto office",
      ageHours: 69,
      description:
        "The Wi-Fi connection in the Toronto site office drops every 10-15 minutes, affecting the whole team's ability to work.",
      status: "RESOLUTION_REVIEW",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer2,
      franchiseCode: "TOR",
      assigneeId: agent,
      priority: "HIGH",
      resolutionSummary: "Replaced the faulty access point in the Toronto office.",
      resolutionSteps:
        "1. Identified failing access point via signal logs. 2. Swapped hardware. 3. Confirmed stable connection for 2 hours.",
    },
    {
      subject: "VPN client repeatedly disconnects",
      ageHours: 96,
      description:
        "My VPN disconnects every time I switch Wi-Fi networks and I have to manually reconnect and re-authenticate each time.",
      status: "RESOLVED",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer,
      franchiseCode: "VAN",
      assigneeId: agent,
      priority: "MEDIUM",
      resolutionSummary:
        "Reset the VPN client profile, which resolved the repeated disconnects.",
      resolutionSteps:
        "1. Cleared cached credentials. 2. Reinstalled the VPN profile. 3. Verified stable connection across network switches.",
    },
    {
      subject: "Training portal login error",
      ageHours: 168,
      description:
        "I could not log into the training portal to complete a required course module before the deadline.",
      status: "CLOSED",
      departmentKey: "TRAINING",
      submittedById: customer2,
      franchiseCode: "CAL",
      assigneeId: manager,
      priority: "LOW",
      resolutionSummary:
        "Reset the learning portal password and confirmed successful login.",
      resolutionSteps:
        "1. Verified account was not locked. 2. Issued a password reset link. 3. Confirmed course access.",
    },
    {
      subject: "Invoice number missing from portal",
      ageHours: 121,
      description:
        "An invoice I submitted three weeks ago never appeared in the accounting portal for review.",
      status: "REOPENED",
      departmentKey: "ACCOUNTING_SERVICES",
      submittedById: customer,
      franchiseCode: "VAN",
      assigneeId: ids["accounting-agent"],
      priority: "MEDIUM",
      resolutionSummary: "Located and re-submitted the missing invoice.",
      resolutionSteps:
        "1. Searched the intake log. 2. Found the invoice stuck in a validation queue. 3. Manually re-submitted it.",
    },
    {
      subject: "Duplicate ticket -- please close",
      ageHours: 139,
      description:
        "I accidentally submitted this ticket twice, please cancel this one and keep the other.",
      status: "CANCELLED",
      departmentKey: "TECHNOLOGY_SUPPORT",
      submittedById: customer2,
      franchiseCode: "CAL",
      priority: "LOW",
    },
  ];

  // Numbered oldest first, so the number a ticket carries agrees with when it
  // was raised. The array above is grouped by status for readability, which is
  // not the order a real desk would have handed these numbers out in.
  const inOrder = [...tickets].sort((a, b) => b.ageHours - a.ageHours);
  for (let i = 0; i < inOrder.length; i++) {
    await seedTicket(ids, TICKET_NUMBER_BASE, inOrder[i]!, i);
  }

  // The counter is what live tickets draw from, and the seed writes its
  // numbers directly -- so without this the first ticket anyone files is
  // SD-000001 sitting in a list of SD-001000s. That is the first thing an
  // audience notices, and it makes the desk look empty. Advance it (never
  // backwards -- a re-seeded database may already be well past this) so the
  // demo ticket continues the sequence the seeded history established.
  const lastSeeded = TICKET_NUMBER_BASE + inOrder.length - 1;
  const counter = await db.ticketNumberCounter.findUnique({ where: { id: 1 } });
  if ((counter?.value ?? 0) < lastSeeded) {
    await db.ticketNumberCounter.upsert({
      where: { id: 1 },
      create: { id: 1, value: lastSeeded },
      update: { value: lastSeeded },
    });
  }

  console.log(
    `Seeded ${tickets.length} tickets covering every lifecycle status, ` +
      `numbered to ${`SD-${String(lastSeeded).padStart(6, "0")}`}.`,
  );
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run seed data against NODE_ENV=production");
  }

  await seedRolesAndDepartments();
  await seedFranchises();
  const ids = await seedDevIdentities();
  await seedKnowledgeBase(ids);
  await seedTickets(ids);

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
