import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import {
  createFranchise,
  createTestUser,
  getDepartmentId,
} from "@/test-support/fixtures";
import {
  confirmTriage,
  createTicket,
  resolveTicket,
  selfAssignTicket,
  transitionTicketStatus,
} from "@/lib/tickets/ticket-service";
import { recordKnowledgeOutcome } from "@/lib/knowledge/knowledge-service";
import { recordSimilarityCheck } from "@/lib/knowledge/similarity";
import type { CreateTicketInput } from "@/lib/validation/ticket-schemas";
import { getTeamReport } from "./team-report-service";

// createTicket() looks up the submitter's Entra department over the
// network -- stubbed as "not found" so this suite never depends on real
// network access (same pattern as ticket-service.integration.test.ts).
vi.mock("@/lib/graph/client", () => ({
  graphFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
}));

function ticketInput(): CreateTicketInput {
  return {
    subject: "VPN drops every afternoon",
    description: "The VPN client disconnects around 2pm every day this week.",
    isProjectRelated: false,
    urls: [],
    consentAcknowledged: true,
    attemptedArticleIds: [],
  };
}

/** Requires a live Postgres connection -- see docs/TESTING.md. */
describe("team-report-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function createPublishedArticle(departmentId: string, createdById: string) {
    const suffix = randomUUID().slice(0, 8);
    return db.knowledgeArticle.create({
      data: {
        articleKey: `KB-TEST-${suffix}`,
        slug: `test-article-${suffix}`,
        departmentId,
        title: `Test article ${suffix}`,
        summary: "Fixture article for team-report integration tests.",
        status: "PUBLISHED",
        filePath: `technology-support/test-article-${suffix}.md`,
        contentHash: suffix,
        createdById,
        publishedAt: new Date(),
      },
    });
  }

  /**
   * Drives a ticket through triage -> assignment -> resolution via the
   * real service layer (so TicketAssignmentHistory/TicketStatusHistory
   * rows are written exactly as production would), then backdates the
   * ticket's createdAt and the two history rows to land at explicit
   * points in time -- Prisma's @default(now())/@updatedAt can't be set
   * on create, so this is the only way to construct a deliberate
   * timeline for report assertions.
   */
  async function resolveBackdated(opts: {
    customer: Awaited<ReturnType<typeof createTestUser>>;
    triage: Awaited<ReturnType<typeof createTestUser>>;
    agent: Awaited<ReturnType<typeof createTestUser>>;
    article: Awaited<ReturnType<typeof createPublishedArticle>>;
    ticketCreatedAt: Date;
    assignedAt: Date;
    resolvedAt: Date;
  }) {
    const created = await createTicket(opts.customer, ticketInput());
    const queued = await confirmTriage(opts.triage, {
      ticketId: created.id,
      version: created.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });
    const assigned = await selfAssignTicket(opts.agent, queued.id, queued.version);
    const inProgress = await transitionTicketStatus(opts.agent, {
      ticketId: assigned.id,
      version: assigned.version,
      toStatus: "IN_PROGRESS",
    });
    await resolveTicket(opts.agent, {
      ticketId: inProgress.id,
      version: inProgress.version,
      resolutionSummary: "Reset the VPN client profile.",
      resolutionSteps: "1. Cleared cached credentials. 2. Reinstalled profile.",
    });
    await recordSimilarityCheck({
      ticketId: inProgress.id,
      performedById: opts.agent.userId,
      rawQueryText: "vpn drops",
      candidateArticleIds: [opts.article.id],
    });
    const outcome = await recordKnowledgeOutcome(opts.agent, {
      ticketId: inProgress.id,
      articleId: opts.article.id,
      outcomeType: "LINKED_EXISTING",
    });
    expect(outcome.gateResult?.ticket.status).toBe("RESOLVED");

    await db.ticket.update({
      where: { id: created.id },
      data: { createdAt: opts.ticketCreatedAt },
    });
    await db.ticketAssignmentHistory.updateMany({
      where: { ticketId: created.id, toAssigneeId: opts.agent.userId },
      data: { createdAt: opts.assignedAt },
    });
    await db.ticketStatusHistory.updateMany({
      where: { ticketId: created.id, toStatus: "RESOLVED" },
      data: { createdAt: opts.resolvedAt },
    });

    return created.id;
  }

  it("computes assigned/resolved counts and average resolution time per agent, scoped to the department and period", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const manager = await createTestUser({
      roles: ["DEPARTMENT_MANAGER"],
      departments: [{ key: "TECHNOLOGY_SUPPORT", isManager: true }],
    });
    const alice = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      displayName: "Alice Agent",
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const article = await createPublishedArticle(techDeptId, manager.userId);
    void franchise;

    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-08T00:00:00.000Z"); // exclusive

    // Two tickets resolved by Alice inside the window: 4h and 8h -> avg 6h.
    await resolveBackdated({
      customer,
      triage,
      agent: alice,
      article,
      ticketCreatedAt: new Date("2026-06-02T09:00:00.000Z"),
      assignedAt: new Date("2026-06-02T09:05:00.000Z"),
      resolvedAt: new Date("2026-06-02T13:00:00.000Z"), // +4h
    });
    await resolveBackdated({
      customer,
      triage,
      agent: alice,
      article,
      ticketCreatedAt: new Date("2026-06-03T09:00:00.000Z"),
      assignedAt: new Date("2026-06-03T09:05:00.000Z"),
      resolvedAt: new Date("2026-06-03T17:00:00.000Z"), // +8h
    });

    // One ticket resolved well outside the window -- must not count.
    await resolveBackdated({
      customer,
      triage,
      agent: alice,
      article,
      ticketCreatedAt: new Date("2026-05-01T09:00:00.000Z"),
      assignedAt: new Date("2026-05-01T09:05:00.000Z"),
      resolvedAt: new Date("2026-05-01T10:00:00.000Z"),
    });

    const rows = await getTeamReport(manager, techDeptId, { from, to });

    const aliceRow = rows.find((r) => r.agentId === alice.userId);
    expect(aliceRow).toBeDefined();
    expect(aliceRow!.assignedCount).toBe(2);
    expect(aliceRow!.resolvedCount).toBe(2);
    expect(aliceRow!.avgResolutionHours).toBe(6);
  });

  it("includes an agent with zero activity in the period, with a null average", async () => {
    const manager = await createTestUser({
      roles: ["DEPARTMENT_MANAGER"],
      departments: [{ key: "TECHNOLOGY_SUPPORT", isManager: true }],
    });
    const idle = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      displayName: "Idle Agent",
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    const rows = await getTeamReport(manager, techDeptId, {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-08T00:00:00.000Z"),
    });

    const idleRow = rows.find((r) => r.agentId === idle.userId);
    expect(idleRow).toBeDefined();
    expect(idleRow!.assignedCount).toBe(0);
    expect(idleRow!.resolvedCount).toBe(0);
    expect(idleRow!.avgResolutionHours).toBeNull();
    expect(idleRow!.stillInDepartment).toBe(true);
  });

  it("includes a resolution exactly at the lower bound, excludes one exactly at the (exclusive) upper bound", async () => {
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const manager = await createTestUser({
      roles: ["DEPARTMENT_MANAGER"],
      departments: [{ key: "TECHNOLOGY_SUPPORT", isManager: true }],
    });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const article = await createPublishedArticle(techDeptId, manager.userId);

    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-08T00:00:00.000Z");

    await resolveBackdated({
      customer,
      triage,
      agent,
      article,
      ticketCreatedAt: new Date("2026-05-30T00:00:00.000Z"),
      assignedAt: from,
      resolvedAt: from, // exactly at the inclusive lower bound
    });
    await resolveBackdated({
      customer,
      triage,
      agent,
      article,
      ticketCreatedAt: new Date("2026-05-30T00:00:00.000Z"),
      assignedAt: to,
      resolvedAt: to, // exactly at the exclusive upper bound
    });

    const rows = await getTeamReport(manager, techDeptId, { from, to });
    const row = rows.find((r) => r.agentId === agent.userId)!;
    expect(row.resolvedCount).toBe(1);
    expect(row.assignedCount).toBe(1);
  });

  it("refuses a manager of a different department", async () => {
    const manager = await createTestUser({
      roles: ["DEPARTMENT_MANAGER"],
      departments: [{ key: "TRAINING", isManager: true }],
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    await expect(
      getTeamReport(manager, techDeptId, {
        from: new Date("2026-06-01T00:00:00.000Z"),
        to: new Date("2026-06-08T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an administrator view any department's report without being a member", async () => {
    // No department membership at all for this admin -- isAdministrator()
    // bypasses the membership check entirely (unlike a plain manager, who
    // must actually manage the department being viewed).
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    const rows = await getTeamReport(admin, techDeptId, {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-08T00:00:00.000Z"),
    });
    expect(Array.isArray(rows)).toBe(true);
  });
});
