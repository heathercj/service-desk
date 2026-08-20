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
