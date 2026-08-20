import type { RoleName, TicketStatus } from "@prisma/client";

/**
 * Centralized, tested ticket state machine (Section 10). Every status
 * transition in the product must go through `isTransitionAllowed()` /
 * `assertTransition()` -- nothing sets `ticket.status` directly.
 *
 * Role checks here are necessary but not sufficient: department-scoped
 * roles (DEPARTMENT_AGENT/DEPARTMENT_MANAGER) are further checked against
 * the ticket's actual department by the ticket service layer, since this
 * module has no concept of department membership.
 */

export const TICKET_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_TRIAGE",
  "WAITING_FOR_CUSTOMER",
  "QUEUED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING",
  "RESOLUTION_REVIEW",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const satisfies readonly TicketStatus[];

interface TransitionRule {
  from: TicketStatus;
  to: TicketStatus;
  allowedRoles: RoleName[];
  requiresReason?: boolean;
}

const AGENT_ROLES: RoleName[] = [
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "ADMINISTRATOR",
];
const TRIAGE_ROLES: RoleName[] = ["TRIAGE_AGENT", "ADMINISTRATOR"];
const CANCEL_ROLES: RoleName[] = ["TRIAGE_AGENT", "DEPARTMENT_MANAGER", "ADMINISTRATOR"];
const REOPEN_ROLES: RoleName[] = [
  "CUSTOMER",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "ADMINISTRATOR",
];

const CANCELLABLE_FROM: TicketStatus[] = [
  "SUBMITTED",
  "IN_TRIAGE",
  "WAITING_FOR_CUSTOMER",
  "QUEUED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING",
  "RESOLUTION_REVIEW",
];

export const TRANSITIONS: TransitionRule[] = [
  { from: "DRAFT", to: "SUBMITTED", allowedRoles: ["CUSTOMER", "ADMINISTRATOR"] },

  { from: "SUBMITTED", to: "IN_TRIAGE", allowedRoles: TRIAGE_ROLES },

  { from: "IN_TRIAGE", to: "WAITING_FOR_CUSTOMER", allowedRoles: TRIAGE_ROLES },
  { from: "IN_TRIAGE", to: "QUEUED", allowedRoles: TRIAGE_ROLES },

  {
    from: "WAITING_FOR_CUSTOMER",
    to: "IN_TRIAGE",
    allowedRoles: ["CUSTOMER", ...TRIAGE_ROLES],
  },
  {
    from: "WAITING_FOR_CUSTOMER",
    to: "IN_PROGRESS",
    allowedRoles: ["CUSTOMER", ...AGENT_ROLES],
  },

  { from: "QUEUED", to: "ASSIGNED", allowedRoles: AGENT_ROLES },
  { from: "ASSIGNED", to: "IN_PROGRESS", allowedRoles: AGENT_ROLES },
  { from: "ASSIGNED", to: "QUEUED", allowedRoles: AGENT_ROLES },

  { from: "IN_PROGRESS", to: "WAITING_FOR_CUSTOMER", allowedRoles: AGENT_ROLES },
  { from: "IN_PROGRESS", to: "PENDING", allowedRoles: AGENT_ROLES },
  { from: "IN_PROGRESS", to: "RESOLUTION_REVIEW", allowedRoles: AGENT_ROLES },

  { from: "PENDING", to: "IN_PROGRESS", allowedRoles: AGENT_ROLES },

  { from: "RESOLUTION_REVIEW", to: "IN_PROGRESS", allowedRoles: AGENT_ROLES },
  { from: "RESOLUTION_REVIEW", to: "RESOLVED", allowedRoles: AGENT_ROLES },

  { from: "RESOLVED", to: "CLOSED", allowedRoles: AGENT_ROLES },
  { from: "RESOLVED", to: "REOPENED", allowedRoles: REOPEN_ROLES, requiresReason: true },
  { from: "CLOSED", to: "REOPENED", allowedRoles: REOPEN_ROLES, requiresReason: true },

  { from: "REOPENED", to: "QUEUED", allowedRoles: AGENT_ROLES },
  { from: "REOPENED", to: "IN_PROGRESS", allowedRoles: AGENT_ROLES },

  ...CANCELLABLE_FROM.map(
    (from): TransitionRule => ({
      from,
      to: "CANCELLED",
      allowedRoles: CANCEL_ROLES,
      requiresReason: true,
    }),
  ),
];

function findRule(from: TicketStatus, to: TicketStatus): TransitionRule | undefined {
  return TRANSITIONS.find((r) => r.from === from && r.to === to);
}

export function isTransitionAllowed(
  from: TicketStatus,
  to: TicketStatus,
  actorRoles: Iterable<RoleName>,
): boolean {
  const rule = findRule(from, to);
  if (!rule) return false;
  const roles = new Set(actorRoles);
  return rule.allowedRoles.some((r) => roles.has(r));
}

export function transitionRequiresReason(from: TicketStatus, to: TicketStatus): boolean {
  return findRule(from, to)?.requiresReason ?? false;
}

export function getAllowedNextStatuses(
  from: TicketStatus,
  actorRoles: Iterable<RoleName>,
): TicketStatus[] {
  const roles = new Set(actorRoles);
  return TRANSITIONS.filter(
    (r) => r.from === from && r.allowedRoles.some((role) => roles.has(role)),
  ).map((r) => r.to);
}

export class InvalidTransitionError extends Error {
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`Cannot transition ticket from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(
  from: TicketStatus,
  to: TicketStatus,
  actorRoles: Iterable<RoleName>,
  reason?: string,
): void {
  if (!isTransitionAllowed(from, to, actorRoles)) {
    throw new InvalidTransitionError(from, to);
  }
  if (transitionRequiresReason(from, to) && !reason?.trim()) {
    throw new Error(`A reason is required to transition from ${from} to ${to}`);
  }
}
