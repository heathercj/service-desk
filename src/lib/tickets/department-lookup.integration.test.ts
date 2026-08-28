import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "@/test-support/fixtures";
import { listAgentsByDepartment } from "./department-lookup";

/**
 * Requires a live Postgres connection -- see README. A deactivated agent
 * must not be offered as an assignment target, so this is only meaningful
 * against a real User row with a real isActive flag.
 */
describe("department-lookup integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("listAgentsByDepartment", () => {
    it("includes an active department member", async () => {
      const agent = await createTestUser({
        roles: ["DEPARTMENT_AGENT"],
        departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      });

      const byDepartment = await listAgentsByDepartment();

      expect(byDepartment.TECHNOLOGY_SUPPORT?.map((a) => a.id)).toContain(agent.userId);
    });

    it("excludes a deactivated department member", async () => {
      const agent = await createTestUser({
        roles: ["DEPARTMENT_AGENT"],
        departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      });
      await db.user.update({ where: { id: agent.userId }, data: { isActive: false } });

      const byDepartment = await listAgentsByDepartment();

      expect(byDepartment.TECHNOLOGY_SUPPORT?.map((a) => a.id)).not.toContain(
        agent.userId,
      );
    });
  });
});
