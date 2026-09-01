import "server-only";
import type { TicketPriority } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { assertAuthorized } from "@/lib/rbac/errors";
import { canViewProductOpsReport, toPolicyActor } from "@/lib/rbac/policies";
import { getRubric, type Rubric } from "./rubric-settings-service";

const IMPROVEMENT_IDEAS_KEY = "IMPROVEMENT_IDEAS";
const MS_PER_HOUR = 3_600_000;

export interface ProductOpsFilters {
  /** Inclusive lower bound, applied to Ticket.createdAt. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

export interface ProductOpsRow {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  departmentName: string;
  priority: TicketPriority;
  status: string;
  createdAt: Date;
  /** Latest TicketStatusHistory row with toStatus = 'RESOLVED', not Ticket.resolvedAt. */
  resolvedAt: Date | null;
  resolutionHours: number | null;
  improvementIdea: boolean;
  /** Honest label: attemptedArticleIds is empty. See product-ops-report-service's docstring below. */
  noKbArticleOpened: boolean;
  reopened: boolean;
  slowToResolve: boolean;
}

export interface TicketCandidate {
  id: string;
  ticketNumber: string;
  subject: string;
  departmentId: string;
  departmentName: string;
  priority: TicketPriority;
  status: string;
  createdAt: Date;
  attemptedArticleIds: string[];
}

export interface StatusEvent {
  ticketId: string;
  toStatus: string;
  createdAt: Date;
}

export function hasAnySignal(row: ProductOpsRow): boolean {
  return (
    row.improvementIdea || row.noKbArticleOpened || row.reopened || row.slowToResolve
  );
}

export type ProductOpsSignalFilter =
  | "all"
  | "improvement-ideas"
  | "no-kb"
  | "reopened"
  | "slow";

/**
 * Single source of truth for "which rows does this view show," shared
 * by the report page and its CSV export route so the two can't drift --
 * exporting always matches whatever the PM was just looking at.
 * "all" means "any signal," not literally every ticket in the period --
 * this is discovery material, not a dump of the whole table.
 */
export function filterProductOpsRows(
  rows: ProductOpsRow[],
  filter: ProductOpsSignalFilter,
): ProductOpsRow[] {
  switch (filter) {
    case "improvement-ideas":
      return rows.filter((r) => r.improvementIdea);
    case "no-kb":
      return rows.filter((r) => r.noKbArticleOpened);
    case "reopened":
      return rows.filter((r) => r.reopened);
    case "slow":
      return rows.filter((r) => r.slowToResolve);
    case "all":
    default:
      return rows.filter(hasAnySignal);
  }
}

/**
 * Pure fold: raw ticket rows + status-history events -> one row per
 * ticket with all four signals attached.
 *
 * Resolution timing is sourced from the LATEST `TicketStatusHistory`
 * row with `toStatus = 'RESOLVED'`, never `Ticket.resolvedAt` (which
 * gets silently overwritten on re-resolution after a reopen -- same
 * reasoning as `team-report-service.ts`). A ticket resolved twice
 * therefore reports the second resolution's timing, and is separately
 * flagged `reopened` regardless.
 */
export function foldProductOpsRows(
  tickets: TicketCandidate[],
  statusEvents: StatusEvent[],
  improvementIdeasDeptId: string,
  rubric: Rubric,
): ProductOpsRow[] {
  const eventsByTicket = new Map<string, StatusEvent[]>();
  for (const event of statusEvents) {
    const list = eventsByTicket.get(event.ticketId) ?? [];
    list.push(event);
    eventsByTicket.set(event.ticketId, list);
  }

  return tickets.map((t) => {
    const events = eventsByTicket.get(t.id) ?? [];
    const reopened = events.some((e) => e.toStatus === "REOPENED");

    const latestResolved = events
      .filter((e) => e.toStatus === "RESOLVED")
      .reduce<StatusEvent | null>(
        (latest, e) => (!latest || e.createdAt > latest.createdAt ? e : latest),
        null,
      );
    const resolvedAt = latestResolved?.createdAt ?? null;
    const resolutionHours = resolvedAt
      ? (resolvedAt.getTime() - t.createdAt.getTime()) / MS_PER_HOUR
      : null;
    const slowToResolve =
      resolutionHours !== null &&
      resolutionHours > rubric.targetHoursByPriority[t.priority] + rubric.graceHours;

    return {
      ticketId: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      departmentName: t.departmentName,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      resolvedAt,
      resolutionHours,
      improvementIdea: t.departmentId === improvementIdeasDeptId,
      noKbArticleOpened: t.attemptedArticleIds.length === 0,
      reopened,
      slowToResolve,
    };
  });
}

/**
 * Raw discovery feed for the Product Manager: every ticket in the
 * period flagged with which of the four zero-new-agent-effort signals
 * it matches. Not clustered or pre-ranked -- the PM synthesizes
 * patterns themselves (deliberate, see the reporting-portal Phase 2
 * plan). `noKbArticleOpened` means "the customer opened none of the
 * pre-ticket suggested articles," not "no relevant article existed" --
 * the ticket form never records what was suggested, only what was
 * opened, so this can't distinguish "nothing relevant existed" from
 * "customer ignored what was shown."
 */
export async function getProductOpsReport(
  actor: AuthContext,
  filters: ProductOpsFilters,
): Promise<ProductOpsRow[]> {
  assertAuthorized(
    canViewProductOpsReport(toPolicyActor(actor)),
    "You cannot view this report",
  );

  const [improvementIdeasDept, rubric, tickets, statusEvents] = await Promise.all([
    db.department.findUnique({ where: { key: IMPROVEMENT_IDEAS_KEY } }),
    getRubric(),
    db.ticket.findMany({
      where: { createdAt: { gte: filters.from, lt: filters.to } },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        departmentId: true,
        priority: true,
        status: true,
        createdAt: true,
        attemptedArticleIds: true,
        department: { select: { name: true } },
      },
    }),
    db.ticketStatusHistory.findMany({
      where: {
        toStatus: { in: ["REOPENED", "RESOLVED"] },
        ticket: { createdAt: { gte: filters.from, lt: filters.to } },
      },
      select: { ticketId: true, toStatus: true, createdAt: true },
    }),
  ]);

  const candidates: TicketCandidate[] = tickets.map((t) => ({
    id: t.id,
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    departmentId: t.departmentId,
    departmentName: t.department.name,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    attemptedArticleIds: t.attemptedArticleIds,
  }));

  return foldProductOpsRows(
    candidates,
    statusEvents,
    improvementIdeasDept?.id ?? "",
    rubric,
  );
}
