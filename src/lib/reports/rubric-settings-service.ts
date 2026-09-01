import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { assertAuthorized } from "@/lib/rbac/errors";
import { canManageReportSettings, toPolicyActor } from "@/lib/rbac/policies";
import { recordAuditEvent } from "@/lib/audit/audit-log";

// snake_case, matching the one existing AppSetting consumer's key naming
// (src/lib/graph/mailbox-subscription.ts's "graph_email_subscription").
export const RUBRIC_SETTING_KEY = "product_operating_model_rubric";

const rubricSchema = z.object({
  targetHoursByPriority: z.object({
    LOW: z.number().positive(),
    MEDIUM: z.number().positive(),
    HIGH: z.number().positive(),
    URGENT: z.number().positive(),
  }),
  graceHours: z.number().positive(),
});

export type Rubric = z.infer<typeof rubricSchema>;

export const DEFAULT_RUBRIC: Rubric = {
  targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72, LOW: 120 },
  graceHours: 72,
};

/**
 * Never throws: a missing or malformed `AppSetting` row must not break
 * the report that depends on it, so an invalid shape silently falls
 * back to the default rather than surfacing a 500 to the viewer.
 */
export function parseRubric(value: unknown): Rubric {
  const parsed = rubricSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_RUBRIC;
}

export async function getRubric(): Promise<Rubric> {
  const row = await db.appSetting.findUnique({ where: { key: RUBRIC_SETTING_KEY } });
  return parseRubric(row?.value);
}

export async function saveRubric(actor: AuthContext, input: Rubric): Promise<Rubric> {
  assertAuthorized(
    canManageReportSettings(toPolicyActor(actor)),
    "Administrator access required",
  );

  const value = rubricSchema.parse(input);

  await db.appSetting.upsert({
    where: { key: RUBRIC_SETTING_KEY },
    create: { key: RUBRIC_SETTING_KEY, value, updatedById: actor.userId },
    update: { value, updatedById: actor.userId },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "REPORT_SETTINGS_UPDATED",
    entityType: "AppSetting",
    entityId: RUBRIC_SETTING_KEY,
    newValue: value,
  });

  return value;
}
