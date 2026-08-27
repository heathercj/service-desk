import { describe, afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createTestUser, ensureRolesAndDepartments } from "@/test-support/fixtures";
import {
  getNotificationPreferences,
  listStaffOptedIntoNotification,
  updateNotificationPreferences,
} from "./preferences-service";

/**
 * Requires a live Postgres connection -- see README. A missing
 * NotificationPreference row has to mean "all defaults", not "no
 * preferences", so the default-read path is only meaningful against a real
 * absent row, not a mock.
 */
describe("preferences-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
    await ensureRolesAndDepartments();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("reading preferences", () => {
    it("defaults every toggle on when the user has never saved preferences", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      const prefs = await getNotificationPreferences(agent.userId);

      expect(prefs).toEqual({
        ticketAssignedEmail: true,
        ticketCommentedEmail: true,
        knowledgeArticlePublishedEmail: true,
      });
    });

    it("reflects a saved preference once one exists", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      await updateNotificationPreferences(agent, {
        ticketAssignedEmail: false,
        ticketCommentedEmail: true,
        knowledgeArticlePublishedEmail: false,
      });

      expect(await getNotificationPreferences(agent.userId)).toEqual({
        ticketAssignedEmail: false,
        ticketCommentedEmail: true,
        knowledgeArticlePublishedEmail: false,
      });
    });
  });

  describe("saving preferences", () => {
    it("lets a staff member save their own preferences, upserting on repeat saves", async () => {
      const km = await createTestUser({ roles: ["KNOWLEDGE_MANAGER"] });

      await updateNotificationPreferences(km, {
        ticketAssignedEmail: false,
        ticketCommentedEmail: false,
        knowledgeArticlePublishedEmail: false,
      });
      await updateNotificationPreferences(km, {
        ticketAssignedEmail: true,
        ticketCommentedEmail: false,
        knowledgeArticlePublishedEmail: false,
      });

      const rows = await db.notificationPreference.findMany({
        where: { userId: km.userId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ticketAssignedEmail: true });
    });

    it("refuses a customer-only actor, and creates no row", async () => {
      const customer = await createTestUser({ roles: ["CUSTOMER"] });

      await expect(
        updateNotificationPreferences(customer, {
          ticketAssignedEmail: false,
          ticketCommentedEmail: false,
          knowledgeArticlePublishedEmail: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(
        await db.notificationPreference.findUnique({
          where: { userId: customer.userId },
        }),
      ).toBeNull();
    });
  });

  describe("listing staff opted into a notification", () => {
    it("includes staff who have never saved preferences (default on)", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });

      const listed = await listStaffOptedIntoNotification(
        "knowledgeArticlePublishedEmail",
      );

      expect(listed.map((u) => u.id)).toContain(agent.userId);
    });

    it("excludes staff who have opted out", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      await updateNotificationPreferences(agent, {
        ticketAssignedEmail: true,
        ticketCommentedEmail: true,
        knowledgeArticlePublishedEmail: false,
      });

      const listed = await listStaffOptedIntoNotification(
        "knowledgeArticlePublishedEmail",
      );

      expect(listed.map((u) => u.id)).not.toContain(agent.userId);
    });

    it("excludes customer-only users entirely", async () => {
      const customer = await createTestUser({ roles: ["CUSTOMER"] });

      const listed = await listStaffOptedIntoNotification(
        "knowledgeArticlePublishedEmail",
      );

      expect(listed.map((u) => u.id)).not.toContain(customer.userId);
    });
  });
});
