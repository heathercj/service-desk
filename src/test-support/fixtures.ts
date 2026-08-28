import { randomUUID } from "node:crypto";
import type { RoleName } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { ROLE_NAMES, DEPARTMENTS, FRANCHISES } from "@/lib/reference-data";

/**
 * Test-only fixture helpers for integration tests. These talk directly to
 * the database (no Auth.js involved) and construct `AuthContext` objects
 * directly, since the service layer only needs that shape -- this is a
 * deliberate benefit of keeping the service layer decoupled from Auth.js.
 */

export async function ensureRolesAndDepartments() {
  for (const name of ROLE_NAMES) {
    await db.role.upsert({ where: { name }, create: { name }, update: {} });
  }
  for (const d of DEPARTMENTS) {
    await db.department.upsert({ where: { key: d.key }, create: d, update: {} });
  }
  // createTicket() derives franchiseId from the actor's Entra department
  // rather than taking it as input, falling back to the seeded "HQ"
  // franchise when there's no match -- see franchise-lookup.ts. Every
  // ticket-creating test needs at least that one to exist.
  for (const f of FRANCHISES) {
    await db.franchise.upsert({ where: { code: f.code }, create: f, update: {} });
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
  departments?: Array<{ key: string; isManager?: boolean }>;
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

export async function getDepartmentId(key: string): Promise<string> {
  const department = await db.department.findUniqueOrThrow({ where: { key } });
  return department.id;
}
