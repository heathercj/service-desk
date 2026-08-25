import { describe, afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createTestUser, ensureRolesAndDepartments } from "@/test-support/fixtures";
import {
  listAuditEventsForAdmin,
  listUsersForAdmin,
  setDepartmentActive,
  setUserRole,
} from "./admin-service";

/**
 * Requires a live Postgres connection -- see README.
 *
 * Granting a role and closing a department are the two ways a person's
 * authority in this system changes, so both are only meaningful against real
 * rows: a grant has to be idempotent against the unique constraint it upserts
 * on, and both have to leave an audit trail. Neither survives a mocked db.
 */
describe("admin-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
    await ensureRolesAndDepartments();
  });

  afterAll(async () => {
    // setDepartmentActive touches a row the rest of the suite shares. Integration
    // tests run serially (fileParallelism: false), so nothing observes the gap,
    // but the row must not be left closed for the next run.
    await db.department.update({ where: { key: "LEGAL" }, data: { isActive: true } });
    await db.$disconnect();
  });

  async function rolesOf(userId: string): Promise<string[]> {
    const rows = await db.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return rows.map((r) => r.role.name).sort();
  }

  describe("granting and revoking a role", () => {
    it("grants a role the user did not have", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({ roles: ["CUSTOMER"] });

      await setUserRole(admin, target.userId, "KNOWLEDGE_MANAGER", true);

      expect(await rolesOf(target.userId)).toEqual(["CUSTOMER", "KNOWLEDGE_MANAGER"]);
    });

    it("granting a role the user already has is a no-op, not a duplicate", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({ roles: ["CUSTOMER"] });

      await setUserRole(admin, target.userId, "TRIAGE_AGENT", true);
      await setUserRole(admin, target.userId, "TRIAGE_AGENT", true);

      expect(await rolesOf(target.userId)).toEqual(["CUSTOMER", "TRIAGE_AGENT"]);
    });

    it("revokes a role, leaving the user's other roles alone", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({ roles: ["CUSTOMER", "TRIAGE_AGENT"] });

      await setUserRole(admin, target.userId, "TRIAGE_AGENT", false);

      expect(await rolesOf(target.userId)).toEqual(["CUSTOMER"]);
    });

    it("revoking a role the user never had is harmless", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({ roles: ["CUSTOMER"] });

      await setUserRole(admin, target.userId, "ADMINISTRATOR", false);

      expect(await rolesOf(target.userId)).toEqual(["CUSTOMER"]);
    });

    it("records who granted the role, and to whom", async () => {
      const admin = await createTestUser({
        roles: ["ADMINISTRATOR"],
        displayName: "Ada Admin",
      });
      const target = await createTestUser({ roles: ["CUSTOMER"] });

      await setUserRole(admin, target.userId, "DEPARTMENT_AGENT", true);

      const event = await db.auditEvent.findFirst({
        where: { entityType: "User", entityId: target.userId, action: "ROLE_GRANTED" },
        orderBy: { createdAt: "desc" },
      });
      expect(event).toMatchObject({
        actorId: admin.userId,
        actorDisplayName: "Ada Admin",
        newValue: { role: "DEPARTMENT_AGENT" },
      });
    });

    it("records a revocation distinctly from a grant", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({ roles: ["CUSTOMER", "TRIAGE_AGENT"] });

      await setUserRole(admin, target.userId, "CUSTOMER", false);

      const event = await db.auditEvent.findFirst({
        where: { entityType: "User", entityId: target.userId },
        orderBy: { createdAt: "desc" },
      });
      expect(event?.action).toBe("ROLE_REVOKED");
    });

    it("refuses a non-administrator, and changes nothing", async () => {
      const manager = await createTestUser({ roles: ["DEPARTMENT_MANAGER"] });
      const target = await createTestUser({ roles: ["CUSTOMER"] });

      await expect(
        setUserRole(manager, target.userId, "ADMINISTRATOR", true),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(await rolesOf(target.userId)).toEqual(["CUSTOMER"]);
    });
  });

  describe("opening and closing a department", () => {
    it("closes a department and records who closed it", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const legal = await db.department.findUniqueOrThrow({ where: { key: "LEGAL" } });

      const updated = await setDepartmentActive(admin, legal.id, false);

      expect(updated.isActive).toBe(false);

      const event = await db.auditEvent.findFirst({
        where: { entityType: "Department", entityId: legal.id },
        orderBy: { createdAt: "desc" },
      });
      expect(event).toMatchObject({
        action: "DEPARTMENT_DEACTIVATED",
        actorId: admin.userId,
      });
    });

    it("reopens a closed department under a distinct audit action", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const legal = await db.department.findUniqueOrThrow({ where: { key: "LEGAL" } });

      await setDepartmentActive(admin, legal.id, false);
      const updated = await setDepartmentActive(admin, legal.id, true);

      expect(updated.isActive).toBe(true);

      const event = await db.auditEvent.findFirst({
        where: { entityType: "Department", entityId: legal.id },
        orderBy: { createdAt: "desc" },
      });
      expect(event?.action).toBe("DEPARTMENT_ACTIVATED");
    });

    it("refuses a non-administrator, and leaves the department open", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const legal = await db.department.findUniqueOrThrow({ where: { key: "LEGAL" } });

      await expect(setDepartmentActive(agent, legal.id, false)).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      const after = await db.department.findUniqueOrThrow({ where: { key: "LEGAL" } });
      expect(after.isActive).toBe(true);
    });
  });

  describe("reading the admin lists", () => {
    it("lists users with the roles and departments an admin screen needs", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({
        roles: ["DEPARTMENT_AGENT"],
        departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      });

      const users = await listUsersForAdmin(admin);
      const listed = users.find((u) => u.id === target.userId);

      expect(listed?.roles.map((r) => r.role.name)).toEqual(["DEPARTMENT_AGENT"]);
      expect(listed?.departmentMemberships.map((m) => m.department.key)).toEqual([
        "TECHNOLOGY_SUPPORT",
      ]);
    });

    it("refuses to list users for a non-administrator", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      await expect(listUsersForAdmin(agent)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("returns audit events newest first, capped at the requested limit", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const target = await createTestUser({ roles: ["CUSTOMER"] });

      await setUserRole(admin, target.userId, "TRIAGE_AGENT", true);
      await setUserRole(admin, target.userId, "KNOWLEDGE_MANAGER", true);
      await setUserRole(admin, target.userId, "DEPARTMENT_AGENT", true);

      const events = await listAuditEventsForAdmin(admin, 2);

      expect(events).toHaveLength(2);
      const [newest, next] = events;
      expect(newest!.createdAt.getTime()).toBeGreaterThanOrEqual(
        next!.createdAt.getTime(),
      );
    });

    it("refuses to show the audit trail to a non-administrator", async () => {
      const manager = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });

      await expect(listAuditEventsForAdmin(manager)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });
});
