import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createTestUser, getDepartmentId } from "@/test-support/fixtures";
import { getKnowledgeReport } from "./knowledge-report-service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Requires a live Postgres connection -- see docs/TESTING.md. */
describe("knowledge-report-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function createArticle(
    departmentId: string,
    createdById: string,
    overrides: Partial<{
      contentUpdatedAt: Date;
      usageCount: number;
      helpfulCount: number;
      notHelpfulCount: number;
      deflectionCount: number;
      status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
      title: string;
    }> = {},
  ) {
    const suffix = randomUUID().slice(0, 8);
    return db.knowledgeArticle.create({
      data: {
        articleKey: `KB-TEST-${suffix}`,
        slug: `test-article-${suffix}`,
        departmentId,
        title: overrides.title ?? `Test article ${suffix}`,
        summary: "Fixture article for KB report integration tests.",
        status: overrides.status ?? "PUBLISHED",
        filePath: `technology-support/test-article-${suffix}.md`,
        contentHash: suffix,
        createdById,
        publishedAt: new Date(),
        contentUpdatedAt: overrides.contentUpdatedAt ?? new Date(),
        usageCount: overrides.usageCount ?? 0,
        helpfulCount: overrides.helpfulCount ?? 0,
        notHelpfulCount: overrides.notHelpfulCount ?? 0,
        deflectionCount: overrides.deflectionCount ?? 0,
      },
    });
  }

  it("flags an article as stale when contentUpdatedAt is older than the threshold, not updatedAt", async () => {
    const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    const staleArticle = await createArticle(techDeptId, km.userId, {
      contentUpdatedAt: new Date(Date.now() - 400 * DAY_MS),
    });
    // Bumping usageCount (simulating a recent *view*) also bumps
    // updatedAt via @updatedAt -- contentUpdatedAt must be unaffected,
    // and this article must still show as stale.
    await db.knowledgeArticle.update({
      where: { id: staleArticle.id },
      data: { usageCount: { increment: 1 } },
    });

    const freshArticle = await createArticle(techDeptId, km.userId, {
      contentUpdatedAt: new Date(),
    });

    const rows = await getKnowledgeReport(km, { staleDays: 365 });

    const staleRow = rows.find((r) => r.articleId === staleArticle.id)!;
    const freshRow = rows.find((r) => r.articleId === freshArticle.id)!;
    expect(staleRow.isStale).toBe(true);
    expect(freshRow.isStale).toBe(false);
  });

  it("flags an article as unused only when it has zero engagement of any kind", async () => {
    const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    const trulyUnused = await createArticle(techDeptId, km.userId);
    const viewed = await createArticle(techDeptId, km.userId, { usageCount: 3 });

    const proposedUpdateOnly = await createArticle(techDeptId, km.userId);
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const ticket = await db.ticket.create({
      data: {
        ticketNumber: `TEST-${randomUUID().slice(0, 8)}`,
        submittedById: customer.userId,
        submittedName: customer.displayName,
        submittedEmail: customer.email,
        franchiseId: (
          await db.franchise.upsert({
            where: { code: "TESTFR" },
            create: { name: "Test Franchise", code: "TESTFR" },
            update: {},
          })
        ).id,
        subject: "Test ticket",
        description: "Fixture ticket for KB report integration tests.",
        submittedDepartmentId: techDeptId,
        departmentId: techDeptId,
      },
    });
    await db.ticketKnowledgeLink.create({
      data: {
        ticketId: ticket.id,
        articleId: proposedUpdateOnly.id,
        outcomeType: "PROPOSED_UPDATE",
        createdById: km.userId,
      },
    });

    const rows = await getKnowledgeReport(km, {});

    expect(rows.find((r) => r.articleId === trulyUnused.id)!.isUnused).toBe(true);
    expect(rows.find((r) => r.articleId === viewed.id)!.isUnused).toBe(false);
    expect(rows.find((r) => r.articleId === proposedUpdateOnly.id)!.isUnused).toBe(false);
  });

  it("counts tickets solved as LINKED_EXISTING links only", async () => {
    const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const article = await createArticle(techDeptId, km.userId);
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const franchise = await db.franchise.upsert({
      where: { code: "TESTFR2" },
      create: { name: "Test Franchise 2", code: "TESTFR2" },
      update: {},
    });

    for (const outcomeType of [
      "LINKED_EXISTING",
      "LINKED_EXISTING",
      "PROPOSED_UPDATE",
    ] as const) {
      const ticket = await db.ticket.create({
        data: {
          ticketNumber: `TEST-${randomUUID().slice(0, 8)}`,
          submittedById: customer.userId,
          submittedName: customer.displayName,
          submittedEmail: customer.email,
          franchiseId: franchise.id,
          subject: "Test ticket",
          description: "Fixture ticket for KB report integration tests.",
          submittedDepartmentId: techDeptId,
          departmentId: techDeptId,
        },
      });
      await db.ticketKnowledgeLink.create({
        data: {
          ticketId: ticket.id,
          articleId: article.id,
          outcomeType,
          createdById: km.userId,
        },
      });
    }

    const rows = await getKnowledgeReport(km, {});
    expect(rows.find((r) => r.articleId === article.id)!.ticketsSolvedCount).toBe(2);
  });

  it("excludes archived articles", async () => {
    const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });
    const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");
    const archived = await createArticle(techDeptId, km.userId, { status: "ARCHIVED" });

    const rows = await getKnowledgeReport(km, {});
    expect(rows.some((r) => r.articleId === archived.id)).toBe(false);
  });

  it("refuses a non-knowledge-manager", async () => {
    const agent = await createTestUser({
      roles: ["DEPARTMENT_AGENT"],
      departments: [{ key: "TECHNOLOGY_SUPPORT" }],
    });
    await expect(getKnowledgeReport(agent, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
