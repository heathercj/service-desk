import { randomUUID } from "node:crypto";
import { describe, afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import {
  createTestUser,
  ensureRolesAndDepartments,
  getDepartmentId,
} from "@/test-support/fixtures";
import { confirmTriage, createTicket } from "@/lib/tickets/ticket-service";
import {
  createDepartment,
  listAuditEventsForAdmin,
  listUsersForAdmin,
  provisionUserByEmail,
  renameDepartment,
  setDepartmentActive,
  setDepartmentMembership,
  setUserActive,
  setUserRole,
} from "./admin-service";

// provisionUserByEmail looks up unknown emails via app-only Graph
// (User.Read.All) -- stubbed the same way ticket-service.integration.test.ts
// stubs it, so the suite never depends on real network access.
vi.mock("@/lib/graph/client", () => ({ graphFetch: vi.fn() }));
const { graphFetch } = await import("@/lib/graph/client");

function mockGraphUser(
  profile: {
    id: string;
    displayName: string;
    mail: string;
    department: string | null;
  } | null,
) {
  vi.mocked(graphFetch).mockResolvedValue({
    ok: profile !== null,
    json: async () => profile ?? {},
  } as Response);
}

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

  beforeEach(() => {
    vi.mocked(graphFetch).mockReset();
    mockGraphUser(null);
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

  describe("provisioning an agent by email", () => {
    it("returns an existing local user by email, without creating a duplicate", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const existing = await createTestUser({ roles: ["CUSTOMER"] });

      const result = await provisionUserByEmail(admin, existing.email);

      expect(result.id).toBe(existing.userId);
      expect(await db.user.count({ where: { email: existing.email } })).toBe(1);
    });

    it("provisions a new user found in the Entra directory", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const email = `new-hire-${randomUUID()}@alairhomes.com`;
      const entraId = randomUUID();
      mockGraphUser({
        id: entraId,
        displayName: "New Hire",
        mail: email,
        department: null,
      });

      const result = await provisionUserByEmail(admin, email);

      expect(result.email).toBe(email);
      expect(result.entraObjectId).toBe(entraId);
      expect(
        await db.user.findUnique({ where: { entraObjectId: entraId } }),
      ).not.toBeNull();
    });

    it("throws NotFoundError when there is no local account or Entra match", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

      await expect(
        provisionUserByEmail(admin, `nobody-${randomUUID()}@alairhomes.com`),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("records an audit event only when a new user is actually created", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const existing = await createTestUser({ roles: ["CUSTOMER"] });

      await provisionUserByEmail(admin, existing.email);
      expect(
        await db.auditEvent.count({
          where: { action: "USER_PROVISIONED", entityId: existing.userId },
        }),
      ).toBe(0);

      const email = `new-hire-${randomUUID()}@alairhomes.com`;
      mockGraphUser({
        id: randomUUID(),
        displayName: "New Hire",
        mail: email,
        department: null,
      });
      const created = await provisionUserByEmail(admin, email);
      expect(
        await db.auditEvent.count({
          where: { action: "USER_PROVISIONED", entityId: created.id },
        }),
      ).toBe(1);
    });

    it("refuses a non-administrator", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      await expect(
        provisionUserByEmail(agent, `whoever-${randomUUID()}@alairhomes.com`),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("assigning department membership", () => {
    it("grants membership with the requested manager flag", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const deptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await setDepartmentMembership(admin, agent.userId, deptId, {
        isMember: true,
        isManager: true,
      });

      const membership = await db.departmentMembership.findUnique({
        where: { userId_departmentId: { userId: agent.userId, departmentId: deptId } },
      });
      expect(membership?.isManager).toBe(true);
    });

    it("updates the manager flag on an existing membership without duplicating the row", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const agent = await createTestUser({
        roles: ["DEPARTMENT_AGENT"],
        departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      });
      const deptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await setDepartmentMembership(admin, agent.userId, deptId, {
        isMember: true,
        isManager: true,
      });

      const rows = await db.departmentMembership.findMany({
        where: { userId: agent.userId, departmentId: deptId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.isManager).toBe(true);
    });

    it("revokes membership", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const agent = await createTestUser({
        roles: ["DEPARTMENT_AGENT"],
        departments: [{ key: "TECHNOLOGY_SUPPORT" }],
      });
      const deptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await setDepartmentMembership(admin, agent.userId, deptId, {
        isMember: false,
        isManager: false,
      });

      const membership = await db.departmentMembership.findUnique({
        where: { userId_departmentId: { userId: agent.userId, departmentId: deptId } },
      });
      expect(membership).toBeNull();
    });

    it("revoking a membership that never existed is harmless", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const deptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await expect(
        setDepartmentMembership(admin, agent.userId, deptId, {
          isMember: false,
          isManager: false,
        }),
      ).resolves.not.toThrow();
    });

    it("refuses a non-administrator", async () => {
      const manager = await createTestUser({ roles: ["DEPARTMENT_MANAGER"] });
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const deptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await expect(
        setDepartmentMembership(manager, agent.userId, deptId, {
          isMember: true,
          isManager: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("activating and deactivating a user", () => {
    it("deactivates a user", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      const updated = await setUserActive(admin, agent.userId, false);

      expect(updated.isActive).toBe(false);
    });

    it("reactivates a user", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      await setUserActive(admin, agent.userId, false);

      const updated = await setUserActive(admin, agent.userId, true);

      expect(updated.isActive).toBe(true);
    });

    it("refuses to let an administrator deactivate themselves", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

      await expect(setUserActive(admin, admin.userId, false)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("refuses a non-administrator", async () => {
      const manager = await createTestUser({ roles: ["DEPARTMENT_MANAGER"] });
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      await expect(setUserActive(manager, agent.userId, false)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("creating a department (flagship: create, then actually use it)", () => {
    it("a newly created department can immediately receive a routed ticket", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const triage = await createTestUser({ roles: ["TRIAGE_AGENT"] });
      const customer = await createTestUser({ roles: ["CUSTOMER"] });

      const department = await createDepartment(
        admin,
        `Alair Performance Team ${randomUUID().slice(0, 8)}`,
      );
      expect(department.key).toMatch(/^ALAIR_PERFORMANCE_TEAM_/);

      const ticket = await createTicket(customer, {
        subject: "Where do I submit my performance review?",
        description:
          "I can't find where to submit my quarterly performance review documents.",
        isProjectRelated: false,
        urls: [],
        consentAcknowledged: true,
        attemptedArticleIds: [],
      });

      const routed = await confirmTriage(triage, {
        ticketId: ticket.id,
        version: ticket.version,
        departmentKey: department.key,
        priority: "MEDIUM",
        tags: [],
      });

      expect(routed.departmentId).toBe(department.id);
      expect(routed.status).toBe("QUEUED");
    });

    it("derives an uppercase-snake-case key from the name", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

      const department = await createDepartment(
        admin,
        `Sales & Marketing -- EMEA ${randomUUID().slice(0, 8)}`,
      );

      expect(department.key).toMatch(/^SALES_MARKETING_EMEA_[0-9A-F]{8}$/);
      expect(department.isActive).toBe(true);
    });

    it("refuses a name that collides with an existing department's derived key", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const uniqueSuffix = randomUUID().slice(0, 8);
      await createDepartment(admin, `Facilities ${uniqueSuffix}`);

      await expect(
        createDepartment(admin, `Facilities ${uniqueSuffix}`),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("refuses a name with no letters or digits (empty derived key)", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });

      await expect(createDepartment(admin, "!!! ---")).rejects.toThrow();
    });

    it("records who created it", async () => {
      const admin = await createTestUser({
        roles: ["ADMINISTRATOR"],
        displayName: "Ada Admin",
      });

      const department = await createDepartment(
        admin,
        `New Department ${randomUUID().slice(0, 8)}`,
      );

      const event = await db.auditEvent.findFirst({
        where: { action: "DEPARTMENT_CREATED", entityId: department.id },
      });
      expect(event?.actorId).toBe(admin.userId);
    });

    it("refuses a non-administrator", async () => {
      const manager = await createTestUser({ roles: ["DEPARTMENT_MANAGER"] });

      await expect(
        createDepartment(manager, `Should Not Exist ${randomUUID().slice(0, 8)}`),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("renaming a department", () => {
    it("updates the name without changing the key", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const department = await createDepartment(
        admin,
        `Original Name ${randomUUID().slice(0, 8)}`,
      );

      const renamed = await renameDepartment(admin, department.id, "Renamed Department");

      expect(renamed.name).toBe("Renamed Department");
      expect(renamed.key).toBe(department.key);
    });

    it("refuses a non-administrator", async () => {
      const manager = await createTestUser({ roles: ["DEPARTMENT_MANAGER"] });
      const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await expect(
        renameDepartment(manager, techDeptId, "Hijacked Name"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("protecting the default intake department", () => {
    it("refuses to deactivate Technology Support, the default routing target", async () => {
      const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
      const techDeptId = await getDepartmentId("TECHNOLOGY_SUPPORT");

      await expect(setDepartmentActive(admin, techDeptId, false)).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      const after = await db.department.findUniqueOrThrow({ where: { id: techDeptId } });
      expect(after.isActive).toBe(true);
    });
  });
});
