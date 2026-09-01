import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { assertAuthorized } from "@/lib/rbac/errors";
import { canViewDepartmentWorkload, toPolicyActor } from "@/lib/rbac/policies";

export interface TeamReportFilters {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound -- callers pass the day *after* the last day wanted. */
  to: Date;
}

export interface AgentMetricRow {
  agentId: string;
  agentName: string;
  /** False if the agent has since left this department -- their historical activity still counts. */
  stillInDepartment: boolean;
  assignedCount: number;
  resolvedCount: number;
  /** Null (not 0) when the agent resolved nothing in the period. */
  avgResolutionHours: number | null;
}

interface AssignmentEventRow {
  ticketId: string;
  toAssigneeId: string | null;
}

interface ResolutionEventRow {
  changedById: string;
  createdAt: Date;
  ticketCreatedAt: Date;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Pure fold turning raw event rows into one row per agent.
 *
 * "Assigned" counts DISTINCT tickets, not assignment events -- a ticket
 * bounced Alice -> Bob -> Alice must count once for Alice, not twice
 * (see the failure mode in the docstring above team-report-service).
 * "Resolved" is sourced from resolution *events*, not the ticket's
 * mutable resolvedAt/resolvedById columns, so a reopened-then-resolved
 * ticket correctly produces two attributed events instead of one
 * overwriting the other.
 */
export function foldTeamMetrics(
  memberIds: Set<string>,
  agentNames: Map<string, string>,
  assignments: AssignmentEventRow[],
  resolutions: ResolutionEventRow[],
): AgentMetricRow[] {
  const assignedTicketsByAgent = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!a.toAssigneeId) continue;
    const set = assignedTicketsByAgent.get(a.toAssigneeId) ?? new Set<string>();
    set.add(a.ticketId);
    assignedTicketsByAgent.set(a.toAssigneeId, set);
  }

  const resolutionTotalsByAgent = new Map<string, { count: number; totalMs: number }>();
  for (const r of resolutions) {
    const acc = resolutionTotalsByAgent.get(r.changedById) ?? { count: 0, totalMs: 0 };
    acc.count += 1;
    acc.totalMs += r.createdAt.getTime() - r.ticketCreatedAt.getTime();
    resolutionTotalsByAgent.set(r.changedById, acc);
  }

  const allAgentIds = new Set<string>([
    ...memberIds,
    ...assignedTicketsByAgent.keys(),
    ...resolutionTotalsByAgent.keys(),
  ]);

  const rows: AgentMetricRow[] = [...allAgentIds].map((agentId) => {
    const assigned = assignedTicketsByAgent.get(agentId);
    const resolved = resolutionTotalsByAgent.get(agentId);
    return {
      agentId,
      agentName: agentNames.get(agentId) ?? agentId,
      stillInDepartment: memberIds.has(agentId),
      assignedCount: assigned?.size ?? 0,
      resolvedCount: resolved?.count ?? 0,
      avgResolutionHours:
        resolved && resolved.count > 0
          ? resolved.totalMs / resolved.count / MS_PER_HOUR
          : null,
    };
  });

  rows.sort((a, b) => a.agentName.localeCompare(b.agentName));
  return rows;
}

/**
 * Per-agent ticket-assignment and time-to-resolution metrics for a
 * department, scoped to `filters`. Authorization lives here (not just
 * in the page) so the CSV export route can't drift from the HTML view.
 */
export async function getTeamReport(
  actor: AuthContext,
  departmentId: string,
  filters: TeamReportFilters,
): Promise<AgentMetricRow[]> {
  assertAuthorized(
    canViewDepartmentWorkload(toPolicyActor(actor), departmentId),
    "You cannot view this department's reports",
  );

  const [memberships, assignmentRows, resolutionRows] = await Promise.all([
    db.departmentMembership.findMany({
      where: { departmentId, user: { isActive: true } },
      select: { userId: true, user: { select: { displayName: true } } },
    }),
    db.ticketAssignmentHistory.findMany({
      where: {
        createdAt: { gte: filters.from, lt: filters.to },
        ticket: { departmentId },
      },
      select: { ticketId: true, toAssigneeId: true },
    }),
    db.ticketStatusHistory.findMany({
      where: {
        toStatus: "RESOLVED",
        createdAt: { gte: filters.from, lt: filters.to },
        ticket: { departmentId },
      },
      select: {
        changedById: true,
        createdAt: true,
        ticket: { select: { createdAt: true } },
      },
    }),
  ]);

  const memberIds = new Set(memberships.map((m) => m.userId));
  const agentNames = new Map(memberships.map((m) => [m.userId, m.user.displayName]));

  const activeAgentIds = new Set<string>();
  for (const a of assignmentRows) if (a.toAssigneeId) activeAgentIds.add(a.toAssigneeId);
  for (const r of resolutionRows) activeAgentIds.add(r.changedById);

  const departedIds = [...activeAgentIds].filter((id) => !memberIds.has(id));
  if (departedIds.length > 0) {
    const departed = await db.user.findMany({
      where: { id: { in: departedIds } },
      select: { id: true, displayName: true },
    });
    for (const u of departed) agentNames.set(u.id, u.displayName);
  }

  return foldTeamMetrics(
    memberIds,
    agentNames,
    assignmentRows,
    resolutionRows.map((r) => ({
      changedById: r.changedById,
      createdAt: r.createdAt,
      ticketCreatedAt: r.ticket.createdAt,
    })),
  );
}
