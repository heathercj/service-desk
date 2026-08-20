import { randomUUID } from "node:crypto";
import type { RoleName, DepartmentKey } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";

/**
 * Test-only fixture helpers for integration tests. These talk directly to
 * the database (no Auth.js involved) and construct `AuthContext` objects
 * directly, since the service layer only needs that shape -- this is a
 * deliberate benefit of keeping the service layer decoupled from Auth.js.
 */

export async function ensureRolesAndDepartments() {
  const roles: RoleName[] = [
    "CUSTOMER",
    "TRIAGE_AGENT",
    "DEPARTMENT_AGENT",
    "DEPARTMENT_MANAGER",
    "KNOWLEDGE_MANAGER",
    "ADMINISTRATOR",
  ];
  for (const name of roles) {
    await db.role.upsert({ where: { name }, create: { name }, update: {} });
  }

  const departments: Array<{ key: DepartmentKey; name: string }> = [
    { key: "TECHNOLOGY_SUPPORT", name: "Technology Support" },
    { key: "TRAINING", name: "Training" },
    { key: "ACCOUNTING_SERVICES", name: "Accounting Services" },
    { key: "MARKETING", name: "Marketing" },
    { key: "LEGAL", name: "Legal" },
  ];
  for (const d of departments) {
    await db.department.upsert({ where: { key: d.key }, create: d, update: {} });
  }
}

export async function createFranchise(namePrefix = "Test Franchise") {
  return db.franchise.create({
    data: {
      name: `${namePrefix} ${randomUUID().slice(0, 8)}`,
      code: `T${randomUUID().slice(0, 6).toUpperCase()}`,
    },
  });
}

export interface CreateTestUserOptions {
  roles?: RoleName[];
  departments?: Array<{ key: DepartmentKey; isManager?: boolean }>;
  displayName?: string;
}

export async function createTestUser(
  options: CreateTestUserOptions = {},
): Promise<AuthContext> {
  await ensureRolesAndDepartments();

  const id = randomUUID();
  const entraObjectId = `test-${id}`;
  const displayName = options.displayName ?? `Test User ${id.slice(0, 6)}`;

  const user = await db.user.create({
    data: {
      entraObjectId,
      entraTenantId: "11111111-1111-1111-1111-111111111111",
      email: `${id}@dev.example.test`,
      displayName,
      isDevAccount: true,
    },
  });

  for (const roleName of options.roles ?? []) {
    const role = await db.role.findUniqueOrThrow({ where: { name: roleName } });
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  const departments = new Map<string, boolean>();
  for (const dept of options.departments ?? []) {
    const department = await db.department.findUniqueOrThrow({
      where: { key: dept.key },
    });
    await db.departmentMembership.create({
      data: {
        userId: user.id,
        departmentId: department.id,
        isManager: dept.isManager ?? false,
      },
    });
    departments.set(department.id, dept.isManager ?? false);
  }

  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    entraObjectId: user.entraObjectId,
    entraTenantId: user.entraTenantId,
    isDevAccount: true,
    roles: new Set(options.roles ?? []),
    departments,
  };
}

export async function getDepartmentId(key: DepartmentKey): Promise<string> {
  const department = await db.department.findUniqueOrThrow({ where: { key } });
  return department.id;
}
