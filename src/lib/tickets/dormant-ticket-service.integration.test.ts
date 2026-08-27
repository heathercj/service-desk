import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createFranchise,
  createTestUser,
  getDepartmentId,
} from "@/test-support/fixtures";
import {
  attachLastActivityAt,
  findDormantTickets,
  sendDormantTicketAlerts,
} from "./dormant-ticket-service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Requires a live Postgres connection -- see README. "Has this ticket been
 * touched" has to be computed from three real tables (Ticket.updatedAt,
 * ConversationMessage, InternalNote), so this is only meaningful against a
 * real database, not a mock.
 */
describe("dormant-ticket-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function createAssignedTicket(options: {
    assigneeId: string;
    status?: string;
    updatedAt: Date;
  }) {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const departmentId = await getDepartmentId("TECHNOLOGY_SUPPORT");

    const ticket = await db.ticket.create({
      data: {
        ticketNumber: `T-TEST-${randomUUID().slice(0, 8)}`,
        submittedById: customer.userId,
        submittedName: customer.displayName,
        submittedEmail: customer.email,
        franchiseId: franchise.id,
        subject: "VPN keeps disconnecting",
        description: "It disconnects every few minutes.",
        submittedDepartmentId: departmentId,
        departmentId,
        status: (options.status ?? "IN_PROGRESS") as never,
        assigneeId: options.assigneeId,
      },
    });

    return db.ticket.update({
      where: { id: ticket.id },
      data: { updatedAt: options.updatedAt },
    });
  }

  describe("attachLastActivityAt", () => {
    it("uses the ticket's own updatedAt when there is no later child activity", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const staleAt = new Date(Date.now() - 4 * DAY_MS);
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: staleAt,
      });

      const [withActivity] = await attachLastActivityAt([ticket]);

      expect(withActivity!.lastActivityAt.getTime()).toBe(staleAt.getTime());
    });

    it("prefers a later internal note or conversation message over the ticket's updatedAt", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const staleAt = new Date(Date.now() - 10 * DAY_MS);
      const noteAt = new Date(Date.now() - 1 * DAY_MS);
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: staleAt,
      });
      await db.internalNote.create({
        data: {
          ticketId: ticket.id,
          authorId: agent.userId,
          body: "Still investigating.",
          createdAt: noteAt,
        },
      });

      const [withActivity] = await attachLastActivityAt([ticket]);

      expect(withActivity!.lastActivityAt.getTime()).toBe(noteAt.getTime());
    });
  });

  describe("findDormantTickets", () => {
    it("flags a ticket with no activity for 3+ days", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const now = new Date();
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: new Date(now.getTime() - 4 * DAY_MS),
      });

      const dormant = await findDormantTickets(now);

      expect(dormant.map((t) => t.id)).toContain(ticket.id);
    });

    it("does not flag a ticket touched within the last 3 days", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const now = new Date();
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: new Date(now.getTime() - 1 * DAY_MS),
      });

      const dormant = await findDormantTickets(now);

      expect(dormant.map((t) => t.id)).not.toContain(ticket.id);
    });

    it("does not flag a ticket kept alive by a customer reply, even though the row itself is stale", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const customer = await createTestUser({ roles: ["CUSTOMER"] });
      const now = new Date();
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: new Date(now.getTime() - 10 * DAY_MS),
      });
      await db.conversationMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: customer.userId,
          isFromCustomer: true,
          body: "Any update?",
          createdAt: new Date(now.getTime() - 1 * DAY_MS),
        },
      });

      const dormant = await findDormantTickets(now);

      expect(dormant.map((t) => t.id)).not.toContain(ticket.id);
    });

    it("never flags a resolved, closed, or cancelled ticket", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const now = new Date();
      const staleUpdatedAt = new Date(now.getTime() - 30 * DAY_MS);
      const resolved = await createAssignedTicket({
        assigneeId: agent.userId,
        status: "RESOLVED",
        updatedAt: staleUpdatedAt,
      });
      const closed = await createAssignedTicket({
        assigneeId: agent.userId,
        status: "CLOSED",
        updatedAt: staleUpdatedAt,
      });
      const cancelled = await createAssignedTicket({
        assigneeId: agent.userId,
        status: "CANCELLED",
        updatedAt: staleUpdatedAt,
      });

      const dormant = await findDormantTickets(now);

      const dormantIds = dormant.map((t) => t.id);
      expect(dormantIds).not.toContain(resolved.id);
      expect(dormantIds).not.toContain(closed.id);
      expect(dormantIds).not.toContain(cancelled.id);
    });

    it("never flags an unassigned ticket", async () => {
      const franchise = await createFranchise();
      const customer = await createTestUser({ roles: ["CUSTOMER"] });
      const departmentId = await getDepartmentId("TECHNOLOGY_SUPPORT");
      const now = new Date();
      const ticket = await db.ticket.create({
        data: {
          ticketNumber: `T-TEST-${randomUUID().slice(0, 8)}`,
          submittedById: customer.userId,
          submittedName: customer.displayName,
          submittedEmail: customer.email,
          franchiseId: franchise.id,
          subject: "Unassigned stale ticket",
          description: "Nobody has picked this up.",
          submittedDepartmentId: departmentId,
          departmentId,
          status: "QUEUED",
        },
      });
      await db.ticket.update({
        where: { id: ticket.id },
        data: { updatedAt: new Date(now.getTime() - 30 * DAY_MS) },
      });

      const dormant = await findDormantTickets(now);

      expect(dormant.map((t) => t.id)).not.toContain(ticket.id);
    });
  });

  describe("sendDormantTicketAlerts", () => {
    it("emails the assignee and stamps dormantAlertSentAt", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const now = new Date();
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: new Date(now.getTime() - 4 * DAY_MS),
      });

      await sendDormantTicketAlerts(now);

      const email = await db.outboundEmail.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: "desc" },
      });
      expect(email?.toEmail).toBe(agent.email);

      const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(updated.dormantAlertSentAt?.getTime()).toBe(now.getTime());
    });

    it("does not re-alert a ticket that has still seen no activity since the last alert", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const now = new Date();
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: new Date(now.getTime() - 4 * DAY_MS),
      });

      await sendDormantTicketAlerts(now);
      const firstRunCount = await db.outboundEmail.count({
        where: { ticketId: ticket.id },
      });

      await sendDormantTicketAlerts(new Date(now.getTime() + 1 * DAY_MS));
      const secondRunCount = await db.outboundEmail.count({
        where: { ticketId: ticket.id },
      });

      expect(secondRunCount).toBe(firstRunCount);
    });

    it("re-alerts once the ticket goes dormant again after being touched", async () => {
      const agent = await createTestUser({ roles: ["DEPARTMENT_AGENT"] });
      const t0 = new Date();
      const ticket = await createAssignedTicket({
        assigneeId: agent.userId,
        updatedAt: new Date(t0.getTime() - 10 * DAY_MS),
      });

      await sendDormantTicketAlerts(t0);

      // The agent replies an hour after the alert -- a genuine touch.
      const touchedAt = new Date(t0.getTime() + 1 * 60 * 60 * 1000);
      await db.ticket.update({
        where: { id: ticket.id },
        data: { updatedAt: touchedAt },
      });

      // No further activity for 4 more days.
      const laterNow = new Date(touchedAt.getTime() + 4 * DAY_MS);
      await sendDormantTicketAlerts(laterNow);

      const emails = await db.outboundEmail.count({ where: { ticketId: ticket.id } });
      expect(emails).toBe(2);

      const updated = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(updated.dormantAlertSentAt?.getTime()).toBe(laterNow.getTime());
    });
  });
});
