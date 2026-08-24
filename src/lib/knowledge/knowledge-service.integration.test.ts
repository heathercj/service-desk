import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createFranchise, createTestUser } from "@/test-support/fixtures";
import {
  confirmTriage,
  createTicket,
  resolveTicket,
  selfAssignTicket,
  transitionTicketStatus,
} from "@/lib/tickets/ticket-service";
import type { CreateTicketInput } from "@/lib/validation/ticket-schemas";
import {
  createDraftArticle,
  publishArticle,
  recordKnowledgeOutcome,
} from "./knowledge-service";
import { recordSimilarityCheck } from "./similarity";
import { KNOWLEDGE_BASE_ROOT, listAllArticleFiles } from "./markdown-repo";

/** Requires a live Postgres connection -- see README. */
describe("knowledge-service integration", () => {
  // Creating an article writes a real Markdown file under knowledge-base/, so
  // this suite left one behind on every run -- they were being committed by
  // whoever next ran `git add knowledge-base/`. Diffing the directory rather
  // than tracking each creation site means a new test cannot forget to clean
  // up after itself. Safe because integration tests run serially
  // (fileParallelism: false), so nothing else is writing here meanwhile.
  let filesBefore = new Set<string>();

  beforeAll(async () => {
    await db.$connect();
    filesBefore = new Set(await listAllArticleFiles());
  });

  afterAll(async () => {
    for (const rel of await listAllArticleFiles()) {
      if (filesBefore.has(rel)) continue;
      await fs.rm(path.resolve(KNOWLEDGE_BASE_ROOT, rel), { force: true });
    }
    await db.$disconnect();
  });

  async function ticketInput(franchiseId: string): Promise<CreateTicketInput> {
    return {
      franchiseId,
      subject: "Printer shows offline in site office",
      description:
        "The printer has shown offline for two days and we cannot print change orders for the client.",
      isProjectRelated: false,
      urls: [],
      consentAcknowledged: true,
      attemptedArticleIds: [],
    };
  }

  async function ticketInProgress(
    customer: Awaited<ReturnType<typeof createTestUser>>,
    franchiseId: string,
  ) {
    const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });

    const created = await createTicket(customer, await ticketInput(franchiseId));
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
    return { ticket: inProgress, agent };
  }

  it("lets a resolution be completed by linking an existing article", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });

    const existing = await createDraftArticle(km, {
      title: `Printer offline recovery ${randomUUID().slice(0, 8)}`,
      summary: "Steps to bring a printer back online after an offline status.",
      departmentKey: "TECHNOLOGY_SUPPORT",
      tags: ["printer"],
      body: "## Resolution\n\n1. Power-cycle the printer.\n2. Re-add the print queue.",
    });
    await publishArticle(km, existing.id);

    const { ticket, agent } = await ticketInProgress(customer, franchise.id);

    const resolveAttempt = await resolveTicket(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      resolutionSummary: "Power-cycled the printer and re-added the queue.",
      resolutionSteps:
        "1. Power-cycled the printer. 2. Removed and re-added the print queue. 3. Confirmed print job succeeded.",
    });
    expect(resolveAttempt.gate.ok).toBe(false);

    // Section 11.3 requires the similarity check itself, not just the
    // outcome, to be current -- mirrors what the UI's "Run knowledge
    // similarity check" button does before a worker can link/draft/except.
    await recordSimilarityCheck({
      ticketId: ticket.id,
      performedById: agent.userId,
      rawQueryText: "printer offline recovery",
      candidateArticleIds: [existing.id],
    });

    const outcome = await recordKnowledgeOutcome(agent, {
      ticketId: ticket.id,
      articleId: existing.id,
      outcomeType: "LINKED_EXISTING",
    });

    expect(outcome.gateResult?.gate?.ok).toBe(true);
    expect(outcome.gateResult?.ticket.status).toBe("RESOLVED");
  });

  it("lets a resolution be completed by drafting a new article", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const { ticket, agent } = await ticketInProgress(customer, franchise.id);

    await resolveTicket(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      resolutionSummary: "Replaced the failing print spooler service.",
      resolutionSteps:
        "1. Restarted the print spooler. 2. Cleared the stuck job queue. 3. Verified printing worked.",
    });

    const draft = await createDraftArticle(agent, {
      title: `Print spooler recovery ${randomUUID().slice(0, 8)}`,
      summary: "How to recover from a stuck print spooler causing offline printers.",
      departmentKey: "TECHNOLOGY_SUPPORT",
      tags: ["printer", "spooler"],
      body: "## Resolution\n\n1. Restart the print spooler service.\n2. Clear stuck jobs.",
      sourceTicketId: ticket.id,
    });

    const outcome = await recordKnowledgeOutcome(agent, {
      ticketId: ticket.id,
      articleId: draft.id,
      outcomeType: "NEW_DRAFT",
    });

    expect(outcome.gateResult?.gate?.ok).toBe(true);
    expect(outcome.gateResult?.ticket.status).toBe("RESOLVED");
  });

  it("rejects a knowledge exception recorded by a non-Knowledge-Manager", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const { ticket, agent } = await ticketInProgress(customer, franchise.id);

    await resolveTicket(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      resolutionSummary: "This was a one-off, customer-specific hardware failure.",
      resolutionSteps:
        "1. Diagnosed a failed fuser unit. 2. Replaced the unit under warranty.",
    });

    await expect(
      recordKnowledgeOutcome(agent, {
        ticketId: ticket.id,
        outcomeType: "EXCEPTION",
        reason: "One-off hardware failure, not reusable.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an authorized exception resolve the ticket and records an audit event", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });
    const { ticket, agent } = await ticketInProgress(customer, franchise.id);

    await resolveTicket(agent, {
      ticketId: ticket.id,
      version: ticket.version,
      resolutionSummary: "One-off hardware failure specific to this site's printer.",
      resolutionSteps:
        "1. Diagnosed a failed fuser unit. 2. Replaced the unit under warranty.",
    });

    await recordSimilarityCheck({
      ticketId: ticket.id,
      performedById: km.userId,
      rawQueryText: "one-off hardware failure fuser unit",
      candidateArticleIds: [],
    });

    const outcome = await recordKnowledgeOutcome(km, {
      ticketId: ticket.id,
      outcomeType: "EXCEPTION",
      reason: "Site-specific hardware failure; not suitable for reusable documentation.",
    });

    expect(outcome.gateResult?.gate?.ok).toBe(true);
    expect(outcome.gateResult?.ticket.status).toBe("RESOLVED");

    const auditEvent = await db.auditEvent.findFirst({
      where: { action: "TICKET_KNOWLEDGE_OUTCOME_RECORDED", entityId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBe(km.userId);
  });
});
