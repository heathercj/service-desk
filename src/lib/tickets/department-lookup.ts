import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/rbac/errors";

type Executor = PrismaClient | Prisma.TransactionClient;

const MAX_DEPARTMENT_KEY_LENGTH = 80;
// Unicode combining diacritical marks (U+0300-U+036F), the range NFD
// normalization splits accents into. Written as escapes, not literal
// characters, so the source stays reviewable in a plain-ASCII diff.
const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Derives a department's URL/folder-safe key from its display name --
 * uppercase, diacritics stripped rather than dropped (so "Équipe" becomes
 * "EQUIPE", not "_QUIPE"), runs of anything else collapsed to a single
 * underscore. Generated once at creation time and never recomputed: keys
 * are immutable (Section: self-service departments) so existing
 * `/queue/[key]` links and knowledge-base folders never break on a rename.
 *
 * Can return an empty string for a name with no letters or digits at all
 * (e.g. "!!!" or emoji-only) -- callers must reject that rather than
 * create a department whose key is "", which would collide with the
 * `/queue` index route.
 */
export function slugifyDepartmentKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_DEPARTMENT_KEY_LENGTH)
    .replace(/_+$/, "");
}

export async function requireActiveDepartment(key: string, executor: Executor = db) {
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
    where: { user: { isActive: true } },
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

export interface DepartmentOption {
  key: string;
  name: string;
}

/**
 * Active departments, for pickers that let staff choose one by name (triage
 * routing, department transfer, drafting a KB article) -- reading from the
 * database rather than a fixed list is what makes a newly created
 * department usable the moment it's created, and what keeps a renamed
 * department's new name showing up immediately.
 */
export async function listActiveDepartments(): Promise<DepartmentOption[]> {
  return db.department.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { key: true, name: true },
  });
}
