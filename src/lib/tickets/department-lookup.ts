import "server-only";
import type { DepartmentKey, Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/rbac/errors";

type Executor = PrismaClient | Prisma.TransactionClient;

export async function requireActiveDepartment(
  key: DepartmentKey,
  executor: Executor = db,
) {
  const department = await executor.department.findUnique({ where: { key } });
  if (!department || !department.isActive) {
    throw new NotFoundError(`Department "${key}" is not available`);
  }
  return department;
}

export interface DepartmentAgentOption {
  id: string;
  displayName: string;
}

/**
 * Every user with a DepartmentMembership row for a department is eligible to
 * be assigned tickets there -- the same assumption `reassignTicket()` relies
 * on. Used to populate "assign directly to" pickers (e.g. triage routing).
 */
export async function listAgentsByDepartment(): Promise<
  Record<string, DepartmentAgentOption[]>
> {
  const memberships = await db.departmentMembership.findMany({
    include: { user: true, department: true },
  });

  const byDepartment: Record<string, DepartmentAgentOption[]> = {};
  for (const membership of memberships) {
    const key = membership.department.key;
    (byDepartment[key] ??= []).push({
      id: membership.userId,
      displayName: membership.user.displayName,
    });
  }
  return byDepartment;
}
