import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createTestUser, getDepartmentId } from "@/test-support/fixtures";
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
import { RUBRIC_SETTING_KEY } from "./rubric-settings-service";
import { getProductOpsReport } from "./product-ops-report-service";

vi.mock("@/lib/graph/client", () => ({
  graphFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
}));

function ticketInput(overrides: Partial<CreateTicketInput> = {}): CreateTicketInput {
  return {
    subject: "VPN drops every afternoon",
    description: "The VPN client disconnects around 2pm every day this week.",
    isProjectRelated: false,
    urls: [],
    consentAcknowledged: true,
    attemptedArticleIds: [],
    ...overrides,
  };
}

/** Requires a live Postgres connection -- see docs/TESTING.md. */
describe("product-ops-report-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
    // Ensure the default rubric is in effect regardless of what another
    // integration test file left behind (each file's own afterAll cleans
    // up its own row, but this test's thresholds depend on knowing the
    // exact numbers in force).
    await db.appSetting.deleteMany({ where: { key: RUBRIC_SETTING_KEY } });
  });

  afterAll(async () => {
    await db.appSetting.deleteMany({ where: { key: RUBRIC_SETTING_KEY } });
    await db.$disconnect();
  });

  beforeEach(() => vi.clearAllMocks());

  async function createPublishedArticle(departmentId: string, createdById: string) {
    const suffix = randomUUID().slice(0, 8);
    return db.knowledgeArticle.create({
      data: {
        articleKey: `KB-TEST-${suffix}`,
        slug: `test-article-${suffix}`,
        departmentId,
        title: `Test article ${suffix}`,
        summary: "Fixture article for product-ops report integration tests.",
        status: "PUBLISHED",
        filePath: `technology-support/test-article-${suffix}.md`,
        contentHash: suffix,
        createdById,
        publishedAt: new Date(),
      },
    });
  }

  it("flags a ticket routed to Improvement Ideas", async () => {
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

    const created = await createTicket(customer, ticketInput());
    await confirmTriage(triage, {
      ticketId: created.id,
      version: created.version,
      departmentKey: "IMPROVEMENT_IDEAS",
      priority: "LOW",
      tags: [],
    });

    const from = new Date(Date.now() - 24 * 3_600_000);
    const to = new Date(Date.now() + 24 * 3_600_000);
    const rows = await getProductOpsReport(admin, { from, to });

    const row = rows.find((r) => r.ticketId === created.id);
    expect(row?.improvementIdea).toBe(true);
  });

  it("flags a ticket with no attempted (opened) suggested articles, not one where the customer opened one", async () => {
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

    const withNone = await createTicket(
      customer,
      ticketInput({ attemptedArticleIds: [] }),
    );
    await confirmTriage(triage, {
      ticketId: withNone.id,
      version: withNone.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    const withOne = await createTicket(
      customer,
      ticketInput({ attemptedArticleIds: [randomUUID()] }),
    );
    await confirmTriage(triage, {
      ticketId: withOne.id,
      version: withOne.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });

    const from = new Date(Date.now() - 24 * 3_600_000);
    const to = new Date(Date.now() + 24 * 3_600_000);
    const rows = await getProductOpsReport(admin, { from, to });

    expect(rows.find((r) => r.ticketId === withNone.id)?.noKbArticleOpened).toBe(true);
    expect(rows.find((r) => r.ticketId === withOne.id)?.noKbArticleOpened).toBe(false);
  });

  it("flags a ticket resolved slower than the rubric, not one resolved within tolerance", async () => {
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const article = await createPublishedArticle(techDeptId, agent.userId);

    async function driveToResolved(resolvedOffsetHours: number) {
      const created = await createTicket(customer, ticketInput());
      const queued = await confirmTriage(triage, {
        ticketId: created.id,
        version: created.version,
        departmentKey: "TECHNOLOGY_SUPPORT",
        priority: "URGENT", // target 8h + grace 72h = 80h threshold
        tags: [],
      });
      const assigned = await selfAssignTicket(agent, queued.id, queued.version);
      const inProgress = await transitionTicketStatus(agent, {
        ticketId: assigned.id,
        version: assigned.version,
        toStatus: "IN_PROGRESS",
      });
      await resolveTicket(agent, {
        ticketId: inProgress.id,
        version: inProgress.version,
        resolutionSummary: "Reset the VPN client profile.",
        resolutionSteps: "1. Cleared cached credentials. 2. Reinstalled profile.",
      });
      await recordSimilarityCheck({
        ticketId: inProgress.id,
        performedById: agent.userId,
        rawQueryText: "vpn drops",
        candidateArticleIds: [article.id],
      });
      await recordKnowledgeOutcome(agent, {
        ticketId: inProgress.id,
        articleId: article.id,
        outcomeType: "LINKED_EXISTING",
      });

      const resolvedAt = new Date(
        created.createdAt.getTime() + resolvedOffsetHours * 3_600_000,
      );
      await db.ticket.update({
        where: { id: created.id },
        data: { createdAt: created.createdAt },
      });
      await db.ticketStatusHistory.updateMany({
        where: { ticketId: created.id, toStatus: "RESOLVED" },
        data: { createdAt: resolvedAt },
      });
      return created.id;
    }

    const fastId = await driveToResolved(40); // well under 80h
    const slowId = await driveToResolved(200); // well over 80h

    const from = new Date(Date.now() - 24 * 3_600_000);
    const to = new Date(Date.now() + 24 * 3_600_000);
    const rows = await getProductOpsReport(admin, { from, to });

    expect(rows.find((r) => r.ticketId === fastId)?.slowToResolve).toBe(false);
    expect(rows.find((r) => r.ticketId === slowId)?.slowToResolve).toBe(true);
  });

  it("flags a reopened-then-re-resolved ticket as reopened, using the second resolution's timing", async () => {
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const article = await createPublishedArticle(techDeptId, agent.userId);

    const created = await createTicket(customer, ticketInput());
    const queued = await confirmTriage(triage, {
      ticketId: created.id,
      version: created.version,
      departmentKey: "TECHNOLOGY_SUPPORT",
      priority: "MEDIUM",
      tags: [],
    });
    const assigned = await selfAssignTicket(agent, queued.id, queued.version);
    let ticket = await transitionTicketStatus(agent, {
      ticketId: assigned.id,
      version: assigned.version,
      toStatus: "IN_PROGRESS",
    });
    await resolveTicket(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      resolutionSummary: "First attempt.",
      resolutionSteps: "Tried resetting the client.",
    });
    await recordSimilarityCheck({
      ticketId: ticket.id,
      performedById: agent.userId,
      rawQueryText: "vpn drops",
      candidateArticleIds: [article.id],
    });
    const firstOutcome = await recordKnowledgeOutcome(agent, {
      ticketId: ticket.id,
      articleId: article.id,
      outcomeType: "LINKED_EXISTING",
    });
    ticket = firstOutcome.gateResult!.ticket;
    expect(ticket.status).toBe("RESOLVED");

    ticket = await transitionTicketStatus(customer, {
      ticketId: ticket.id,
      version: ticket.version,
      toStatus: "REOPENED",
      reason: "The VPN dropped again.",
    });
    ticket = await transitionTicketStatus(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      toStatus: "IN_PROGRESS",
    });
    await resolveTicket(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      resolutionSummary: "Second attempt -- reinstalled the client entirely.",
      resolutionSteps: "Uninstalled and reinstalled the VPN client from scratch.",
    });
    await recordSimilarityCheck({
      ticketId: ticket.id,
      performedById: agent.userId,
      rawQueryText: "vpn drops again",
      candidateArticleIds: [article.id],
    });
    const secondOutcome = await recordKnowledgeOutcome(agent, {
      ticketId: ticket.id,
      articleId: article.id,
      outcomeType: "LINKED_EXISTING",
    });
    expect(secondOutcome.gateResult?.ticket.status).toBe("RESOLVED");

    const resolvedEvents = await db.ticketStatusHistory.findMany({
      where: { ticketId: created.id, toStatus: "RESOLVED" },
      orderBy: { createdAt: "asc" },
    });
    expect(resolvedEvents).toHaveLength(2); // first attempt, then the reopen's re-resolution
    const latestResolvedEvent = resolvedEvents[1]!;

    const from = new Date(Date.now() - 24 * 3_600_000);
    const to = new Date(Date.now() + 24 * 3_600_000);
    const rows = await getProductOpsReport(admin, { from, to });
    const row = rows.find((r) => r.ticketId === created.id);

    expect(row?.reopened).toBe(true);
    expect(row?.resolvedAt?.getTime()).toBe(latestResolvedEvent.createdAt.getTime());
  });

  it("refuses a non-product-manager, non-administrator", async () => {
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    await expect(
      getProductOpsReport(agent, {
        from: new Date(Date.now() - 24 * 3_600_000),
        to: new Date(Date.now() + 24 * 3_600_000),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a product manager and an administrator both view the report", async () => {
    const pm = await createTestUser({ roles: ["PRODUCT_MANAGER"] });
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    const filters = {
      from: new Date(Date.now() - 24 * 3_600_000),
      to: new Date(Date.now() + 24 * 3_600_000),
    };
    await expect(getProductOpsReport(pm, filters)).resolves.toBeInstanceOf(Array);
    await expect(getProductOpsReport(admin, filters)).resolves.toBeInstanceOf(Array);
  });
});
