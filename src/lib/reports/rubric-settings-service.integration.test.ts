import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createTestUser } from "@/test-support/fixtures";
import {
  DEFAULT_RUBRIC,
  RUBRIC_SETTING_KEY,
  getRubric,
  saveRubric,
} from "./rubric-settings-service";

/** Requires a live Postgres connection -- see docs/TESTING.md. */
describe("rubric-settings-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.appSetting.deleteMany({ where: { key: RUBRIC_SETTING_KEY } });
    await db.$disconnect();
  });

  it("returns the default rubric when no AppSetting row exists yet", async () => {
    await db.appSetting.deleteMany({ where: { key: RUBRIC_SETTING_KEY } });
    expect(await getRubric()).toEqual(DEFAULT_RUBRIC);
  });

  it("an administrator can save a new rubric, and getRubric reflects it", async () => {
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    const newRubric = {
      targetHoursByPriority: { URGENT: 4, HIGH: 12, MEDIUM: 48, LOW: 96 },
      graceHours: 24,
    };

    await saveRubric(admin, newRubric);

    expect(await getRubric()).toEqual(newRubric);

    const row = await db.appSetting.findUniqueOrThrow({
      where: { key: RUBRIC_SETTING_KEY },
    });
    expect(row.updatedById).toBe(admin.userId);
  });

  it("saving again updates the existing row rather than creating a second one", async () => {
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    await saveRubric(admin, {
      targetHoursByPriority: { URGENT: 6, HIGH: 18, MEDIUM: 60, LOW: 100 },
      graceHours: 48,
    });
    await saveRubric(admin, {
      targetHoursByPriority: { URGENT: 5, HIGH: 15, MEDIUM: 50, LOW: 90 },
      graceHours: 36,
    });

    const rows = await db.appSetting.findMany({ where: { key: RUBRIC_SETTING_KEY } });
    expect(rows).toHaveLength(1);
    expect(await getRubric()).toEqual({
      targetHoursByPriority: { URGENT: 5, HIGH: 15, MEDIUM: 50, LOW: 90 },
      graceHours: 36,
    });
  });

  it("refuses a non-administrator, including a product manager", async () => {
    const pm = await createTestUser({ roles: ["PRODUCT_MANAGER"] });
    await expect(
      saveRubric(pm, {
        targetHoursByPriority: { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 },
        graceHours: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records an audit event on save", async () => {
    const admin = await createTestUser({ roles: ["ADMINISTRATOR"] });
    await saveRubric(admin, {
      targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72, LOW: 120 },
      graceHours: 72,
    });

    const event = await db.auditEvent.findFirst({
      where: { action: "REPORT_SETTINGS_UPDATED", entityId: RUBRIC_SETTING_KEY },
      orderBy: { createdAt: "desc" },
    });
    expect(event).toBeTruthy();
    expect(event?.actorId).toBe(admin.userId);
  });
});
