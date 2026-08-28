import "server-only";
import type { RoleName } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { canAdminister, toPolicyActor } from "@/lib/rbac/policies";
import { assertAuthorized, ConflictError, NotFoundError } from "@/lib/rbac/errors";
import { recordAuditEvent } from "@/lib/audit/audit-log";
import { env } from "@/lib/env";
import { lookupEntraUser } from "@/lib/tickets/franchise-lookup";
import { slugifyDepartmentKey } from "@/lib/tickets/department-lookup";
import { DEFAULT_DEPARTMENT_KEY } from "@/lib/tickets/department-suggestion";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export async function listUsersForAdmin(actor: AuthContext) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");
  return db.user.findMany({
    include: {
      roles: { include: { role: true } },
      departmentMemberships: { include: { department: true } },
    },
    orderBy: { displayName: "asc" },
  });
}

export async function setUserRole(
  actor: AuthContext,
  userId: string,
  role: RoleName,
  enabled: boolean,
) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");

  const roleRow = await db.role.findUniqueOrThrow({ where: { name: role } });

  if (enabled) {
    await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId: roleRow.id } },
      create: { userId, roleId: roleRow.id },
      update: {},
    });
  } else {
    await db.userRole.deleteMany({ where: { userId, roleId: roleRow.id } });
  }

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: enabled ? "ROLE_GRANTED" : "ROLE_REVOKED",
    entityType: "User",
    entityId: userId,
    newValue: { role },
  });
}

export async function setDepartmentActive(
  actor: AuthContext,
  departmentId: string,
  isActive: boolean,
) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");

  if (!isActive) {
    const target = await db.department.findUnique({ where: { id: departmentId } });
    assertAuthorized(
      target?.key !== DEFAULT_DEPARTMENT_KEY,
      "Cannot deactivate the default intake department -- unrouted tickets fall back to it",
    );
  }

  const updated = await db.department.update({
    where: { id: departmentId },
    data: { isActive },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: isActive ? "DEPARTMENT_ACTIVATED" : "DEPARTMENT_DEACTIVATED",
    entityType: "Department",
    entityId: departmentId,
  });

  return updated;
}

export async function listAuditEventsForAdmin(actor: AuthContext, limit = 100) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");
  return db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

/**
 * Provisions an agent's account by email, ahead of their first sign-in, so
 * roles/departments can be assigned right away rather than waiting on it.
 * Idempotent against an already-existing local account (by email) --
 * calling this again for someone who's already provisioned or has already
 * signed in just returns them, no duplicate row and no audit noise.
 *
 * Deliberately its own function rather than sharing
 * email-intake-service.ts's resolveSubmitter(): that one creates a
 * placeholder identity on a total miss so an inbound email is never lost;
 * here a human administrator should see a clear error instead.
 */
export async function provisionUserByEmail(actor: AuthContext, email: string) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");

  const local = await db.user.findFirst({ where: { email } });
  if (local) return local;

  const profile = await lookupEntraUser(email);
  if (!profile) {
    throw new NotFoundError("No matching account found in the directory for that email");
  }

  const provisioned = await db.user.upsert({
    where: { entraObjectId: profile.id },
    create: {
      entraObjectId: profile.id,
      entraTenantId: env.ENTRA_TENANT_ID,
      email: profile.mail ?? email,
      displayName: profile.displayName,
    },
    update: {},
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "USER_PROVISIONED",
    entityType: "User",
    entityId: provisioned.id,
    newValue: { email: provisioned.email },
  });

  return provisioned;
}

export interface SetDepartmentMembershipInput {
  isMember: boolean;
  isManager: boolean;
}

export async function setDepartmentMembership(
  actor: AuthContext,
  userId: string,
  departmentId: string,
  input: SetDepartmentMembershipInput,
) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");

  if (input.isMember) {
    await db.departmentMembership.upsert({
      where: { userId_departmentId: { userId, departmentId } },
      create: { userId, departmentId, isManager: input.isManager },
      update: { isManager: input.isManager },
    });
  } else {
    await db.departmentMembership.deleteMany({ where: { userId, departmentId } });
  }

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: input.isMember
      ? "DEPARTMENT_MEMBERSHIP_GRANTED"
      : "DEPARTMENT_MEMBERSHIP_REVOKED",
    entityType: "User",
    entityId: userId,
    newValue: { departmentId, isManager: input.isManager },
  });
}

const MAX_DEPARTMENT_NAME_LENGTH = 60;

/**
 * Creates a department from just a display name -- the key (and therefore
 * its `/queue/[key]` URL and knowledge-base folder) is derived once here
 * and never recomputed, so a later rename never breaks an existing link.
 * Refuses rather than auto-suffixing on a key collision: the key is
 * immutable by design, and a suffix like `_2` would be a permanent,
 * confusing artifact nobody chose. Catching the unique-constraint error
 * from the real insert (rather than checking-then-creating) also means
 * there's no race between two admins creating similarly-named departments
 * at once.
 */
export async function createDepartment(actor: AuthContext, name: string) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");

  const trimmedName = name.trim();
  assertAuthorized(
    trimmedName.length > 0 && trimmedName.length <= MAX_DEPARTMENT_NAME_LENGTH,
    `Department name must be between 1 and ${MAX_DEPARTMENT_NAME_LENGTH} characters`,
  );

  const key = slugifyDepartmentKey(trimmedName);
  assertAuthorized(
    key.length > 0,
    "That name doesn't contain any letters or digits to build a department key from",
  );

  let created;
  try {
    created = await db.department.create({ data: { key, name: trimmedName } });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_CONSTRAINT_VIOLATION
    ) {
      throw new ConflictError(
        "A department with a similar name already exists -- choose a more distinct name",
      );
    }
    throw err;
  }

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "DEPARTMENT_CREATED",
    entityType: "Department",
    entityId: created.id,
    newValue: { key: created.key, name: created.name },
  });

  return created;
}

export async function renameDepartment(
  actor: AuthContext,
  departmentId: string,
  name: string,
) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");

  const trimmedName = name.trim();
  assertAuthorized(
    trimmedName.length > 0 && trimmedName.length <= MAX_DEPARTMENT_NAME_LENGTH,
    `Department name must be between 1 and ${MAX_DEPARTMENT_NAME_LENGTH} characters`,
  );

  const previous = await db.department.findUniqueOrThrow({ where: { id: departmentId } });
  const updated = await db.department.update({
    where: { id: departmentId },
    data: { name: trimmedName },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "DEPARTMENT_RENAMED",
    entityType: "Department",
    entityId: departmentId,
    previousValue: { name: previous.name },
    newValue: { name: updated.name },
  });

  return updated;
}

export async function setUserActive(
  actor: AuthContext,
  userId: string,
  isActive: boolean,
) {
  assertAuthorized(canAdminister(toPolicyActor(actor)), "Administrator access required");
  assertAuthorized(
    isActive || userId !== actor.userId,
    "You cannot deactivate your own account",
  );

  const updated = await db.user.update({ where: { id: userId }, data: { isActive } });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    entityType: "User",
    entityId: userId,
  });

  return updated;
}
