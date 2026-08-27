import "server-only";
import type { RoleName } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { canManageNotificationPreferences, toPolicyActor } from "@/lib/rbac/policies";
import { assertAuthorized } from "@/lib/rbac/errors";

export interface NotificationPreferences {
  ticketAssignedEmail: boolean;
  ticketCommentedEmail: boolean;
  knowledgeArticlePublishedEmail: boolean;
}

// A missing row means "all defaults", not "no preferences" -- so every
// existing user gets sensible behaviour without a backfill migration, and a
// newly added toggle doesn't need one either.
const DEFAULT_PREFERENCES: NotificationPreferences = {
  ticketAssignedEmail: true,
  ticketCommentedEmail: true,
  knowledgeArticlePublishedEmail: true,
};

const STAFF_ROLES: RoleName[] = [
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "ADMINISTRATOR",
];

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const row = await db.notificationPreference.findUnique({ where: { userId } });
  if (!row) return DEFAULT_PREFERENCES;
  return {
    ticketAssignedEmail: row.ticketAssignedEmail,
    ticketCommentedEmail: row.ticketCommentedEmail,
    knowledgeArticlePublishedEmail: row.knowledgeArticlePublishedEmail,
  };
}

export async function updateNotificationPreferences(
  actor: AuthContext,
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  assertAuthorized(
    canManageNotificationPreferences(toPolicyActor(actor)),
    "You cannot manage notification preferences",
  );

  return db.notificationPreference.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, ...input },
    update: { ...input },
  });
}

/**
 * Active staff opted into a given notification kind, treating a missing
 * preference row as opted-in (matches the default-on decision). Used to fan
 * out broadcast-style notifications (e.g. a published KB article) that have
 * no single "assignee" to check a preference against.
 */
export async function listStaffOptedIntoNotification(
  kind: keyof NotificationPreferences,
): Promise<Array<{ id: string; email: string; displayName: string }>> {
  const staff = await db.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { name: { in: STAFF_ROLES } } } },
    },
    select: { id: true, email: true, displayName: true },
  });
  if (staff.length === 0) return [];

  const preferences = await db.notificationPreference.findMany({
    where: { userId: { in: staff.map((u) => u.id) } },
  });
  const preferenceByUserId = new Map(preferences.map((p) => [p.userId, p]));

  return staff.filter((user) => {
    const preference = preferenceByUserId.get(user.id);
    return preference ? preference[kind] : true;
  });
}
