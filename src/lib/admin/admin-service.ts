import "server-only";
import type { RoleName } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { canAdminister, toPolicyActor } from "@/lib/rbac/policies";
import { assertAuthorized, NotFoundError } from "@/lib/rbac/errors";
import { recordAuditEvent } from "@/lib/audit/audit-log";
import { env } from "@/lib/env";
import { lookupEntraUser } from "@/lib/tickets/franchise-lookup";

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
