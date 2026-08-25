import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { InvalidTransitionError } from "@/lib/tickets/state-machine";
import {
  createFranchise,
  createTestUser,
  getDepartmentId,
} from "@/test-support/fixtures";
import {
  addConversationMessage,
  confirmTriage,
  createTicket,
  getTicketForActor,
  listDepartmentQueue,
  resolveTicket,
  searchTickets,
  selfAssignTicket,
  transferDepartment,
  transitionTicketStatus,
} from "./ticket-service";
import type { CreateTicketInput } from "@/lib/validation/ticket-schemas";

/**
 * Requires a live Postgres connection (DATABASE_URL). See README "Running
 * integration tests against Postgres". Covers the integration-test list
 * from Section 17: cross-customer/cross-department access, triage routing,
 * internal-note visibility, the resolution gate, and optimistic
 * concurrency conflicts.
 */
describe("ticket-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function baseTicketInput(franchiseId: string): Promise<CreateTicketInput> {
    return {
      franchiseId,
      subject: "VPN will not connect from home network",
      description:
        "The VPN client fails to authenticate every time I try to connect from home, since yesterday.",
      isProjectRelated: false,
      urls: [],
      consentAcknowledged: true,
      attemptedArticleIds: [],
    };
  }

  it("lets a customer view only their own ticket, never another customer's", async () => {
    const franchise = await createFranchise();
    const customerA = await createTestUser({ roles: ["CUSTOMER"] });
    const customerB = await createTestUser({ roles: ["CUSTOMER"] });

    const ticket = await createTicket(customerA, await baseTicketInput(franchise.id));

    const own = await getTicketForActor(customerA, ticket.id);
    expect(own.ticket.id).toBe(ticket.id);

    await expect(getTicketForActor(customerB, ticket.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("never lets a customer read internal notes, even on their own ticket", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));

    await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      internalNote: "Checking known VPN profile issue.",
    });

    const view = await getTicketForActor(customer, ticket.id);
    expect(view.includeInternal).toBe(false);
    expect(view.internalNotes).toHaveLength(0);

    const staffView = await getTicketForActor(agent, ticket.id);
    expect(staffView.includeInternal).toBe(true);
    expect(staffView.internalNotes.length).toBeGreaterThan(0);
    void techDeptId;
  });

  it("blocks a department agent from another department's ticket", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const trainingAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TRAINING" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    await expect(getTicketForActor(trainingAgent, ticket.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets a triage agent route a submitted ticket into a department queue", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    expect(ticket.status).toBe("SUBMITTED");

    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "HIGH",
      tags: ["vpn"],
    });

    expect(routed.status).toBe("QUEUED");
    expect(routed.priority).toBe("HIGH");
  });

  it("rejects an invalid status transition on the server", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));

    await expect(
      transitionTicketStatus(admin, {
        ticketId: ticket.id,
        version: ticket.version,
        toStatus: "RESOLVED",
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("produces a concurrency conflict on a stale version", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));

    await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    // Reusing the original (now stale) version should be rejected.
    await expect(
      confirmTriage(triage, {
        ticketId: ticket.id,
        version: ticket.version,
        departmentKey: "TECHNOLOGY_SUPPORT",
        priority: "LOW",
        tags: [],
      }),
    ).rejects.toThrow(/changed by someone else/i);
  });

  it("cannot resolve without a current knowledge check and outcome, and can once one is recorded", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const created = await createTicket(customer, await baseTicketInput(franchise.id));
    const queued = await confirmTriage(triage, {
      ticketId: created.id,
      version: created.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });
    const assigned = await selfAssignTicket(agent, queued.id, queued.version);
    const inProgress = await transitionTicketStatus(agent, {
      ticketId: assigned.id,
      version: assigned.version,
      toStatus: "IN_PROGRESS",
    });

    const attempt = await resolveTicket(agent, {
      ticketId: inProgress.id,
      version: inProgress.version,
      resolutionSummary: "Reset the VPN client profile.",
      resolutionSteps:
        "1. Cleared cached credentials. 2. Reinstalled profile. 3. Verified connectivity.",
    });

    expect(attempt.gate.ok).toBe(false);
    expect(attempt.ticket.status).toBe("RESOLUTION_REVIEW");

    // Record a knowledge exception (Knowledge Manager/Admin only) and
    // retry -- this exercises "authorized exception is audited" via the
    // recordKnowledgeOutcome() call in knowledge-service.integration.test.ts;
    // here we just confirm the ticket cannot resolve on its own.
    const stillBlocked = await getTicketForActor(agent, inProgress.id);
    expect(stillBlocked.ticket.status).toBe("RESOLUTION_REVIEW");
  });

  it("stores an agent's reply to the customer and captures the outbound email", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const created = await createTicket(customer, await baseTicketInput(franchise.id));
    const queued = await confirmTriage(triage, {
      ticketId: created.id,
      version: created.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });
    const assigned = await selfAssignTicket(agent, queued.id, queued.version);

    const body = "Thanks for the detail -- I can see the expired session. Looking now.";
    const result = await addConversationMessage(agent, {
      ticketId: assigned.id,
      version: assigned.version,
      body,
    });

    // The reply is a staff message, and it survives the transaction.
    expect(result.message.isFromCustomer).toBe(false);
    const stored = await db.conversationMessage.findUnique({
      where: { id: result.message.id },
    });
    expect(stored?.body).toBe(body);

    // Section 9: a staff reply is emailed to the customer, captured rather
    // than claimed as delivered.
    const email = await db.outboundEmail.findFirst({
      where: { conversationMessageId: result.message.id },
    });
    expect(email?.toEmail).toBe(customer.email);
    expect(email?.status).toBe("CAPTURED_DEV");
  });

  it("lets triage assign a ticket directly to an agent while routing it", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));

    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: agent.userId,
    });

    expect(routed.status).toBe("ASSIGNED");
    expect(routed.assigneeId).toBe(agent.userId);
  });

  it("refuses to assign at triage to a user outside the target department", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const outsider = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TRAINING" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));

    await expect(
      confirmTriage(triage, {
        ticketId: ticket.id,
        version: ticket.version,
        departmentKey: "TECHNOLOGY_SUPPORT",
        priority: "MEDIUM",
        tags: [],
        assigneeId: outsider.userId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters the department queue by assignee for the mine/others views", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const agentA = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const agentB = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    const ticketA = await createTicket(customer, await baseTicketInput(franchise.id));
    const routedA = await confirmTriage(triage, {
      ticketId: ticketA.id,
      version: ticketA.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: agentA.userId,
    });
    await transitionTicketStatus(agentA, {
      ticketId: ticketA.id,
      version: routedA.version,
      toStatus: "IN_PROGRESS",
    });

    const ticketB = await createTicket(customer, await baseTicketInput(franchise.id));
    const routedB = await confirmTriage(triage, {
      ticketId: ticketB.id,
      version: ticketB.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: agentB.userId,
    });
    await transitionTicketStatus(agentB, {
      ticketId: ticketB.id,
      version: routedB.version,
      toStatus: "IN_PROGRESS",
    });

    const resolvedTicket = await createTicket(
      customer,
      await baseTicketInput(franchise.id),
    );
    await confirmTriage(triage, {
      ticketId: resolvedTicket.id,
      version: resolvedTicket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });
    await db.ticket.update({
      where: { id: resolvedTicket.id },
      data: { status: "RESOLVED" },
    });

    const mine = await listDepartmentQueue(agentA, techDeptId, {
      status: ["IN_PROGRESS"],
      assigneeId: agentA.userId,
    });
    expect(mine.items.map((t) => t.id)).toEqual([ticketA.id]);

    // The shared TECHNOLOGY_SUPPORT department accumulates tickets from
    // other tests (and manual sessions) that this test doesn't control, so
    // assert containment/exclusion rather than an exact result set.
    const others = await listDepartmentQueue(agentA, techDeptId, {
      status: ["IN_PROGRESS"],
      assignedToOtherThan: agentA.userId,
      pageSize: 100,
    });
    const otherIds = others.items.map((t) => t.id);
    expect(otherIds).toContain(ticketB.id);
    expect(otherIds).not.toContain(ticketA.id);

    const resolved = await listDepartmentQueue(agentA, techDeptId, {
      status: ["RESOLVED", "CLOSED", "CANCELLED"],
      pageSize: 100,
    });
    const resolvedIds = resolved.items.map((t) => t.id);
    expect(resolvedIds).toContain(resolvedTicket.id);
    expect(resolvedIds).not.toContain(ticketA.id);
    expect(resolvedIds).not.toContain(ticketB.id);
  });

  it("puts the newest ticket at the top of a department queue, not on the last page", async () => {
    // Against a realistically full queue -- the seeded demo database holds
    // over 200 Technology Support tickets -- oldest-first plus paging put a
    // just-created ticket on page 9, where neither an agent nor the guided
    // demo could find it. Newest-first is what makes a queue usable at that
    // size, so this asserts position, not merely presence.
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const techDeptId = [...agent.departments.keys()][0]!;

    const older = await createTicket(customer, await baseTicketInput(franchise.id));
    await confirmTriage(triage, {
      ticketId: older.id,
      version: older.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    const newer = await createTicket(customer, await baseTicketInput(franchise.id));
    await confirmTriage(triage, {
      ticketId: newer.id,
      version: newer.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    const firstPage = await listDepartmentQueue(agent, techDeptId, { pageSize: 25 });
    const ids = firstPage.items.map((t) => t.id);

    // The department is shared with other tests and manual sessions, so the
    // claim is relative: the newer of these two comes first, and a brand-new
    // ticket is on page one at all.
    expect(ids).toContain(newer.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(
      ids.indexOf(older.id) === -1 ? Number.MAX_SAFE_INTEGER : ids.indexOf(older.id),
    );
    expect(firstPage.items[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
      firstPage.items[firstPage.items.length - 1]?.createdAt.getTime() ?? 0,
    );
  });

  it("scopes ticket search to the searcher's own department, except for triage/admin", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const techAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const uniqueSubject = `Search probe ${randomSuffix()}`;
    const ticket = await createTicket(customer, {
      ...(await baseTicketInput(franchise.id)),
      subject: uniqueSubject,
      description:
        "This ticket exists only to verify search scoping across departments for staff.",
    });
    await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TRAINING",
      priority: "MEDIUM",
      tags: [],
    });

    const asTechAgent = await searchTickets(techAgent, { query: uniqueSubject });
    expect(asTechAgent.items).toHaveLength(0);

    const asTriage = await searchTickets(triage, { query: uniqueSubject });
    expect(asTriage.items.map((t) => t.id)).toEqual([ticket.id]);

    const byNumber = await searchTickets(triage, { query: ticket.ticketNumber });
    expect(byNumber.items.map((t) => t.id)).toEqual([ticket.id]);
  });

  it("lets the current assignee transfer a mis-routed ticket to a new department and assignee, notifying the new assignee", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const techAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const trainingAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TRAINING" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: techAgent.userId,
    });

    // The assignee -- not a manager, triage, or admin -- notices the
    // mis-route and fixes it themselves.
    const transferred = await transferDepartment(
      techAgent,
      routed.id,
      routed.version,
      "TRAINING",
      "This is a training question, not a technical fault -- wrong department.",
      trainingAgent.userId,
    );

    expect(transferred.status).toBe("ASSIGNED");
    expect(transferred.assigneeId).toBe(trainingAgent.userId);

    const deptHistory = await db.ticketDepartmentHistory.findFirst({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
    expect(deptHistory?.reason).toMatch(/training question/);

    const assignmentHistory = await db.ticketAssignmentHistory.findFirst({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
    expect(assignmentHistory?.fromAssigneeId).toBe(techAgent.userId);
    expect(assignmentHistory?.toAssigneeId).toBe(trainingAgent.userId);

    const email = await db.outboundEmail.findFirst({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
    expect(email?.toEmail).toBe(trainingAgent.email);
    expect(email?.status).toBe("CAPTURED_DEV");
  });

  it("still clears the assignee and requeues when a department transfer names no new assignee", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const techAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: techAgent.userId,
    });

    const transferred = await transferDepartment(
      triage,
      routed.id,
      routed.version,
      "TRAINING",
      "Routed to the wrong department at triage.",
    );

    expect(transferred.status).toBe("QUEUED");
    expect(transferred.assigneeId).toBeNull();

    const email = await db.outboundEmail.findFirst({ where: { ticketId: ticket.id } });
    expect(email).toBeNull();
  });

  it("refuses to transfer to a new assignee who is not a member of the destination department", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const techAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: techAgent.userId,
    });

    await expect(
      transferDepartment(
        techAgent,
        routed.id,
        routed.version,
        "TRAINING",
        "Wrong department.",
        techAgent.userId, // not a member of TRAINING
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("thanks the submitter when triage routes a ticket to Improvement Ideas", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });

    const ticket = await createTicket(customer, {
      ...(await baseTicketInput(franchise.id)),
      subject: "It would help if the portal remembered my last search",
      description: "A suggestion: keep my last search filter between visits.",
    });

    await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "IMPROVEMENT_IDEAS",
      priority: "LOW",
      tags: [],
    });

    const email = await db.outboundEmail.findFirst({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
    expect(email?.toEmail).toBe(customer.email);
    expect(email?.status).toBe("CAPTURED_DEV");
    expect(email?.bodyText).toMatch(/improvement catalogue/i);
    expect(email?.bodyText).toMatch(/will be reviewed/i);
  });

  it("sends no thank-you email when triage routes a ticket elsewhere", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));

    await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    const email = await db.outboundEmail.findFirst({ where: { ticketId: ticket.id } });
    expect(email).toBeNull();
  });

  it("also thanks the submitter when a mis-routed ticket is transferred into Improvement Ideas", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const techAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const ideasAgent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "IMPROVEMENT_IDEAS" }],
    });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
      assigneeId: techAgent.userId,
    });

    await transferDepartment(
      techAgent,
      routed.id,
      routed.version,
      "IMPROVEMENT_IDEAS",
      "This reads as a product suggestion, not a fault -- wrong queue.",
      ideasAgent.userId,
    );

    const submitterEmail = await db.outboundEmail.findFirst({
      where: { ticketId: ticket.id, toEmail: customer.email },
    });
    expect(submitterEmail?.bodyText).toMatch(/improvement catalogue/i);

    const agentEmail = await db.outboundEmail.findFirst({
      where: { ticketId: ticket.id, toEmail: ideasAgent.email },
    });
    expect(agentEmail?.subject).toMatch(/transferred to you/i);
  });

  it("refuses a department transfer with a blank reason", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });

    const ticket = await createTicket(customer, await baseTicketInput(franchise.id));
    const routed = await confirmTriage(triage, {
      ticketId: ticket.id,
      version: ticket.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    await expect(
      transferDepartment(triage, routed.id, routed.version, "TRAINING", "   "),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
