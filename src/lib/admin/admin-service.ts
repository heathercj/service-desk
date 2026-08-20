import "server-only";
import type { RoleName } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { canAdminister, toPolicyActor } from "@/lib/rbac/policies";
import { assertAuthorized } from "@/lib/rbac/errors";
import { recordAuditEvent } from "@/lib/audit/audit-log";

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
