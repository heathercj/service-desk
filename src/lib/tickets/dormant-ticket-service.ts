import "server-only";
import { db } from "@/lib/db";
import { getEmailProvider } from "@/lib/email/provider";
import { ticketDormantEmail } from "@/lib/email/templates";

/**
 * Dormant-ticket alerting (Section: notifications). Unlike the three
 * opt-out-able email preferences, this one is mandatory -- an assigned
 * ticket with no activity for 3 days always emails the assignee.
 *
 * "Activity" isn't one field: Ticket.updatedAt is only bumped by a direct
 * ticket.update() call, so adding an internal note or replying to a
 * customer never touches it on its own. attachLastActivityAt recomputes the
 * real last-touch time from all three sources so the sweep and the queue
 * UI's bell icon agree on what "dormant" means.
 */

export const DORMANT_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

const TERMINAL_STATUSES = ["RESOLVED", "CLOSED", "CANCELLED"] as const;

interface TicketActivityInput {
  id: string;
  updatedAt: Date;
}

export async function attachLastActivityAt<T extends TicketActivityInput>(
  tickets: T[],
): Promise<Array<T & { lastActivityAt: Date }>> {
  if (tickets.length === 0) return [];
  const ticketIds = tickets.map((t) => t.id);

  const [messages, notes] = await Promise.all([
    db.conversationMessage.groupBy({
      by: ["ticketId"],
      where: { ticketId: { in: ticketIds } },
      _max: { createdAt: true },
    }),
    db.internalNote.groupBy({
      by: ["ticketId"],
      where: { ticketId: { in: ticketIds } },
      _max: { createdAt: true },
    }),
  ]);

  const latestMessageByTicket = new Map(
    messages.map((m) => [m.ticketId, m._max.createdAt]),
  );
  const latestNoteByTicket = new Map(notes.map((n) => [n.ticketId, n._max.createdAt]));

  return tickets.map((ticket) => {
    const activityDates = [
      ticket.updatedAt,
      latestMessageByTicket.get(ticket.id),
      latestNoteByTicket.get(ticket.id),
    ].filter((d): d is Date => d != null);
    const lastActivityAt = activityDates.reduce(
      (latest, d) => (d > latest ? d : latest),
      ticket.updatedAt,
    );
    return { ...ticket, lastActivityAt };
  });
}

export function isTicketStale(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() >= DORMANT_THRESHOLD_MS;
}

function needsDormantAlert(
  ticket: { lastActivityAt: Date; dormantAlertSentAt: Date | null },
  now: Date,
): boolean {
  if (!isTicketStale(ticket.lastActivityAt, now)) return false;
  return !ticket.dormantAlertSentAt || ticket.dormantAlertSentAt < ticket.lastActivityAt;
}

export async function findDormantTickets(now: Date) {
  const candidates = await db.ticket.findMany({
    where: {
      assigneeId: { not: null },
      status: { notIn: [...TERMINAL_STATUSES] },
    },
    include: { assignee: true },
  });

  const withActivity = await attachLastActivityAt(candidates);
  return withActivity.filter((ticket) => needsDormantAlert(ticket, now));
}

export async function sendDormantTicketAlerts(now: Date): Promise<string[]> {
  const dormant = await findDormantTickets(now);

  for (const ticket of dormant) {
    if (!ticket.assignee) continue;

    await getEmailProvider().send({
      ticketId: ticket.id,
      toEmail: ticket.assignee.email,
      ...ticketDormantEmail(ticket),
    });

    await db.ticket.update({
      where: { id: ticket.id },
      data: { dormantAlertSentAt: now },
    });
  }

  return dormant.map((t) => t.ticketNumber);
}
