import "server-only";
import type { DepartmentKey, Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import {
  canAddCustomerMessage,
  canAddInternalNote,
  canCreateTicket,
  canReassign,
  canSelfAssign,
  canTransferDepartment,
  canTriageTicket,
  canViewInternalNotes,
  canViewTicket,
  isAdministrator,
  isDepartmentAgentRole,
  isDepartmentMember,
  isKnowledgeManager,
  isTriageAgent,
  toPolicyActor,
} from "@/lib/rbac/policies";
import {
  assertAuthorized,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/rbac/errors";
import { recordAuditEvent } from "@/lib/audit/audit-log";
import { getEmailProvider } from "@/lib/email/provider";
import { evaluateResolutionGate } from "@/lib/knowledge/resolution-gate";
import { validateSubmittedUrls } from "@/lib/validation/url-safety";
import type { CreateTicketInput } from "@/lib/validation/ticket-schemas";
import { requireActiveDepartment } from "./department-lookup";
import { DEFAULT_DEPARTMENT_KEY, suggestDepartment } from "./department-suggestion";
import { assertTransition, isTransitionAllowed } from "./state-machine";
import { nextTicketNumber } from "./ticket-number";

const ACTIVE_STATUSES_FOR_TRANSFER: TicketStatus[] = [
  "IN_TRIAGE",
  "WAITING_FOR_CUSTOMER",
  "QUEUED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING",
];

export async function createTicket(actor: AuthContext, input: CreateTicketInput) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(canCreateTicket(policyActor), "Only customers can submit tickets");

  const franchise = await db.franchise.findUnique({ where: { id: input.franchiseId } });
  if (!franchise || !franchise.isActive)
    throw new NotFoundError("Franchise not found or inactive");

  const urlCheck = validateSubmittedUrls(input.urls, {
    allowHttp: process.env.NODE_ENV !== "production",
  });
  if (!urlCheck.ok) throw new ForbiddenError(urlCheck.errors.join("; "));

  // The customer no longer picks a department -- auto-route by keyword
  // match, falling back to a default queue. Triage reviews and corrects
  // this via "Confirm triage & route" (see department-suggestion.ts).
  const suggestion = suggestDepartment(input.subject, input.description);
  const department = await requireActiveDepartment(
    suggestion?.departmentKey ?? DEFAULT_DEPARTMENT_KEY,
  );

  const ticket = await db.$transaction(async (tx) => {
    const ticketNumber = await nextTicketNumber(tx);

    const created = await tx.ticket.create({
      data: {
        ticketNumber,
        submittedById: actor.userId,
        submittedName: actor.displayName,
        submittedEmail: actor.email,
        franchiseId: franchise.id,
        subject: input.subject,
        description: input.description,
        submittedDepartmentId: department.id,
        departmentId: department.id,
        suggestedDepartmentRationale:
          suggestion?.rationale ??
          "No matching keywords in subject/description -- defaulted to Technology Support",
        isProjectRelated: input.isProjectRelated,
        projectNumber: input.isProjectRelated ? (input.projectNumber ?? null) : null,
        impact: input.impact,
        urgencyNote: input.urgencyNote,
        attemptedArticleIds: input.attemptedArticleIds,
        status: "SUBMITTED",
      },
    });

    const okUrls = urlCheck.results.filter((r) => r.ok);
    if (okUrls.length > 0) {
      await tx.ticketUrl.createMany({
        data: okUrls.map((r) => ({
          ticketId: created.id,
          url: r.normalized!,
          hostname: r.hostname!,
        })),
      });
    }

    await tx.ticketStatusHistory.create({
      data: {
        ticketId: created.id,
        fromStatus: null,
        toStatus: "SUBMITTED",
        changedById: actor.userId,
      },
    });

    await recordAuditEvent(
      {
        actorId: actor.userId,
        actorDisplayName: actor.displayName,
        action: "TICKET_CREATED",
        entityType: "Ticket",
        entityId: created.id,
        newValue: { ticketNumber, departmentId: department.id },
      },
      tx,
    );

    return created;
  });

  return ticket;
}

async function loadTicketOrThrow(
  ticketId: string,
  tx: Prisma.TransactionClient | typeof db = db,
) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new NotFoundError("Ticket not found");
  return ticket;
}

async function loadTicketWithRelationsOrThrow(ticketId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      department: true,
      franchise: true,
      submittedDepartment: true,
      suggestedDepartment: true,
      assignee: true,
      submitter: true,
    },
  });
  if (!ticket) throw new NotFoundError("Ticket not found");
  return ticket;
}

export async function getTicketByNumberForActor(
  actor: AuthContext,
  ticketNumber: string,
) {
  const ticket = await db.ticket.findUnique({ where: { ticketNumber } });
  if (!ticket) throw new NotFoundError("Ticket not found");
  return getTicketForActor(actor, ticket.id);
}

export async function getTicketForActor(actor: AuthContext, ticketId: string) {
  const policyActor = toPolicyActor(actor);
  const ticket = await loadTicketWithRelationsOrThrow(ticketId);
  assertAuthorized(
    canViewTicket(policyActor, ticket),
    "You do not have access to this ticket",
  );

  const includeInternal = canViewInternalNotes(policyActor, ticket);

  const [urls, attachments, conversation, internalNotes, statusHistory, knowledgeLinks] =
    await Promise.all([
      db.ticketUrl.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
      db.attachment.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
      db.conversationMessage.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
      }),
      includeInternal
        ? db.internalNote.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
      db.ticketStatusHistory.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
      }),
      db.ticketKnowledgeLink.findMany({
        where: { ticketId },
        include: { article: true },
      }),
    ]);

  return {
    ticket,
    urls,
    attachments,
    conversation,
    internalNotes,
    statusHistory,
    knowledgeLinks,
    includeInternal,
  };
}

interface SimilarTicketRow {
  id: string;
  ticketNumber: string;
  subject: string;
  status: TicketStatus;
  sim: number;
}

/**
 * Lightweight "possible duplicate" / "similar tickets" signal for the
 * triage and department workbenches (Section 7, 8): trigram similarity on
 * subject within the same department, excluding the ticket itself.
 * Deterministic and local -- no AI provider involved.
 */
export async function findSimilarTickets(
  ticketId: string,
  departmentId: string,
  subject: string,
  limit = 5,
) {
  return db.$queryRaw<SimilarTicketRow[]>`
    SELECT id, "ticketNumber", subject, status, similarity(subject, ${subject}) AS sim
    FROM "Ticket"
    WHERE id != ${ticketId}
      AND "departmentId" = ${departmentId}
      AND similarity(subject, ${subject}) > 0.2
    ORDER BY sim DESC
    LIMIT ${limit}
  `;
}

export interface TicketListFilters {
  status?: TicketStatus[];
  search?: string;
  page?: number;
  pageSize?: number;
  /** Exact-match assignee (e.g. "assigned to me"). */
  assigneeId?: string;
  /** Assignee is set, and is not this user (e.g. "in progress by others"). */
  assignedToOtherThan?: string;
}

function paginate(filters: TicketListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export async function listMyTickets(actor: AuthContext, filters: TicketListFilters = {}) {
  const { skip, take, page, pageSize } = paginate(filters);
  const where: Prisma.TicketWhereInput = {
    submittedById: actor.userId,
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
    ...(filters.search
      ? {
          OR: [
            { subject: { contains: filters.search, mode: "insensitive" } },
            { ticketNumber: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { department: true },
    }),
    db.ticket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function listTriageQueue(
  actor: AuthContext,
  filters: TicketListFilters = {},
) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(canTriageTicket(policyActor), "Triage access required");

  const { skip, take, page, pageSize } = paginate(filters);
  const where: Prisma.TicketWhereInput = {
    status: { in: filters.status?.length ? filters.status : ["SUBMITTED", "IN_TRIAGE"] },
  };

  const [items, total] = await Promise.all([
    db.ticket.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take,
      include: {
        franchise: true,
        department: true,
        submittedDepartment: true,
        suggestedDepartment: true,
      },
    }),
    db.ticket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function listDepartmentQueue(
  actor: AuthContext,
  departmentId: string,
  filters: TicketListFilters = {},
) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(
    isDepartmentMember(policyActor, departmentId),
    "Not a member of this department",
  );

  const { skip, take, page, pageSize } = paginate(filters);
  const where: Prisma.TicketWhereInput = {
    departmentId,
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.assignedToOtherThan
      ? {
          AND: [
            { assigneeId: { not: null } },
            { assigneeId: { not: filters.assignedToOtherThan } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.ticket.findMany({
      where,
      // Newest first. Oldest-first reads like fair FIFO order, but a real
      // department queue is hundreds of tickets deep and paged 25 at a time,
      // so it buried every newly arriving ticket on the last page -- where an
      // agent looking for the thing that just came in would never see it. The
      // triage queue above is deliberately left oldest-first: triage works a
      // short backlog down, and there newest-first would starve the oldest.
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { assignee: true },
    }),
    db.ticket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export interface SearchTicketsFilters {
  query: string;
  page?: number;
  pageSize?: number;
}

/**
 * Cross-department ticket search by number or keyword, scoped to exactly
 * what `canViewTicket` would already let this actor open (Section 10):
 * Administrators and Triage Agents have unconditional ticket visibility,
 * Department Agents/Managers are limited to their own department(s), and
 * no one else can search tickets at all.
 */
export async function searchTickets(actor: AuthContext, filters: SearchTicketsFilters) {
  const policyActor = toPolicyActor(actor);
  const { skip, take, page, pageSize } = paginate(filters);
  const query = filters.query.trim();
  if (!query) return { items: [], total: 0, page, pageSize };

  let scope: Prisma.TicketWhereInput;
  if (isAdministrator(policyActor) || isTriageAgent(policyActor)) {
    scope = {};
  } else if (isDepartmentAgentRole(policyActor)) {
    const departmentIds = [...policyActor.departments.keys()];
    assertAuthorized(departmentIds.length > 0, "You cannot search tickets");
    scope = { departmentId: { in: departmentIds } };
  } else {
    throw new ForbiddenError("You cannot search tickets");
  }

  const where: Prisma.TicketWhereInput = {
    AND: [
      scope,
      {
        OR: [
          { ticketNumber: { contains: query, mode: "insensitive" } },
          { subject: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
    ],
  };

  const [items, total] = await Promise.all([
    db.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { department: true, assignee: true },
    }),
    db.ticket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export interface ConfirmTriageInput {
  ticketId: string;
  version: number;
  franchiseId?: string;
  departmentKey: DepartmentKey;
  category?: string;
  priority: TicketPriority;
  tags: string[];
  internalNote?: string;
  assigneeId?: string;
}

export async function confirmTriage(actor: AuthContext, input: ConfirmTriageInput) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(canTriageTicket(policyActor), "Triage access required");

  const targetDepartment = await requireActiveDepartment(input.departmentKey);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(input.ticketId, tx);
    if (ticket.version !== input.version) {
      throw new ConflictError(
        "This ticket was changed by someone else. Reload and try again.",
      );
    }
    assertAuthorized(
      ticket.status === "SUBMITTED" || ticket.status === "IN_TRIAGE",
      "Ticket is not awaiting triage",
    );

    const previousDepartmentId = ticket.departmentId;
    const previousFranchiseId = ticket.franchiseId;

    // Hop through IN_TRIAGE first if this is the ticket's first triage touch.
    if (ticket.status === "SUBMITTED") {
      assertTransition("SUBMITTED", "IN_TRIAGE", policyActor.roles);
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: "SUBMITTED",
          toStatus: "IN_TRIAGE",
          changedById: actor.userId,
        },
      });
    }
    assertTransition("IN_TRIAGE", "QUEUED", policyActor.roles);

    if (input.assigneeId) {
      const membership = await tx.departmentMembership.findUnique({
        where: {
          userId_departmentId: {
            userId: input.assigneeId,
            departmentId: targetDepartment.id,
          },
        },
      });
      assertAuthorized(
        Boolean(membership),
        "Target user is not a member of this department",
      );
    }

    if (input.internalNote?.trim()) {
      await tx.internalNote.create({
        data: {
          ticketId: ticket.id,
          authorId: actor.userId,
          body: input.internalNote.trim(),
        },
      });
    }

    if (input.tags.length > 0) {
      for (const name of input.tags) {
        const tag = await tx.tag.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        await tx.ticketTag.upsert({
          where: { ticketId_tagId: { ticketId: ticket.id, tagId: tag.id } },
          create: { ticketId: ticket.id, tagId: tag.id },
          update: {},
        });
      }
    }

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: input.assigneeId ? "ASSIGNED" : "QUEUED",
        departmentId: targetDepartment.id,
        franchiseId: input.franchiseId ?? ticket.franchiseId,
        category: input.category ?? ticket.category,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
      },
    });

    await tx.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: "IN_TRIAGE",
        toStatus: "QUEUED",
        changedById: actor.userId,
      },
    });

    if (input.assigneeId) {
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: "QUEUED",
          toStatus: "ASSIGNED",
          changedById: actor.userId,
        },
      });
      await tx.ticketAssignmentHistory.create({
        data: {
          ticketId: ticket.id,
          fromAssigneeId: null,
          toAssigneeId: input.assigneeId,
          changedById: actor.userId,
        },
      });
    }

    if (previousDepartmentId !== targetDepartment.id) {
      await tx.ticketDepartmentHistory.create({
        data: {
          ticketId: ticket.id,
          fromDepartmentId: previousDepartmentId,
          toDepartmentId: targetDepartment.id,
          changedById: actor.userId,
          reason: "Triage routing",
        },
      });
    }

    await recordAuditEvent(
      {
        actorId: actor.userId,
        actorDisplayName: actor.displayName,
        action: "TICKET_TRIAGE_CONFIRMED",
        entityType: "Ticket",
        entityId: ticket.id,
        previousValue: {
          departmentId: previousDepartmentId,
          franchiseId: previousFranchiseId,
          priority: ticket.priority,
        },
        newValue: {
          departmentId: targetDepartment.id,
          priority: input.priority,
          category: input.category,
          assigneeId: input.assigneeId,
        },
      },
      tx,
    );

    return updated;
  });
}

export async function selfAssignTicket(
  actor: AuthContext,
  ticketId: string,
  version: number,
) {
  const policyActor = toPolicyActor(actor);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(ticketId, tx);
    assertAuthorized(
      canSelfAssign(policyActor, ticket),
      "You cannot self-assign this ticket",
    );
    if (ticket.version !== version)
      throw new ConflictError("This ticket was changed by someone else.");
    assertAuthorized(ticket.status === "QUEUED", "Ticket is not in the queue");
    assertTransition("QUEUED", "ASSIGNED", policyActor.roles);

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { version: { increment: 1 }, status: "ASSIGNED", assigneeId: actor.userId },
    });

    await Promise.all([
      tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: "QUEUED",
          toStatus: "ASSIGNED",
          changedById: actor.userId,
        },
      }),
      tx.ticketAssignmentHistory.create({
        data: {
          ticketId: ticket.id,
          fromAssigneeId: null,
          toAssigneeId: actor.userId,
          changedById: actor.userId,
        },
      }),
      recordAuditEvent(
        {
          actorId: actor.userId,
          actorDisplayName: actor.displayName,
          action: "TICKET_SELF_ASSIGNED",
          entityType: "Ticket",
          entityId: ticket.id,
          newValue: { assigneeId: actor.userId },
        },
        tx,
      ),
    ]);

    return updated;
  });
}

export async function reassignTicket(
  actor: AuthContext,
  ticketId: string,
  version: number,
  targetUserId: string,
) {
  const policyActor = toPolicyActor(actor);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(ticketId, tx);
    assertAuthorized(canReassign(policyActor, ticket), "You cannot reassign this ticket");
    if (ticket.version !== version)
      throw new ConflictError("This ticket was changed by someone else.");

    const membership = await tx.departmentMembership.findUnique({
      where: {
        userId_departmentId: { userId: targetUserId, departmentId: ticket.departmentId },
      },
    });
    assertAuthorized(
      Boolean(membership),
      "Target user is not a member of this department",
    );

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: ticket.status === "QUEUED" ? "ASSIGNED" : ticket.status,
        assigneeId: targetUserId,
      },
    });

    await Promise.all([
      tx.ticketAssignmentHistory.create({
        data: {
          ticketId: ticket.id,
          fromAssigneeId: ticket.assigneeId,
          toAssigneeId: targetUserId,
          changedById: actor.userId,
        },
      }),
      recordAuditEvent(
        {
          actorId: actor.userId,
          actorDisplayName: actor.displayName,
          action: "TICKET_REASSIGNED",
          entityType: "Ticket",
          entityId: ticket.id,
          previousValue: { assigneeId: ticket.assigneeId },
          newValue: { assigneeId: targetUserId },
        },
        tx,
      ),
    ]);

    return updated;
  });
}

export interface TransitionInput {
  ticketId: string;
  version: number;
  toStatus: TicketStatus;
  reason?: string;
}

export async function transitionTicketStatus(actor: AuthContext, input: TransitionInput) {
  const policyActor = toPolicyActor(actor);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(input.ticketId, tx);
    assertAuthorized(
      canViewTicket(policyActor, ticket),
      "You do not have access to this ticket",
    );
    if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") {
      // Department scoping still applies for active-department tickets.
      if (
        !policyActor.roles.has("ADMINISTRATOR") &&
        !policyActor.roles.has("TRIAGE_AGENT")
      ) {
        assertAuthorized(
          isDepartmentMember(policyActor, ticket.departmentId) ||
            ticket.submittedById === actor.userId,
          "Not authorized for this ticket's department",
        );
      }
    }
    if (ticket.version !== input.version)
      throw new ConflictError("This ticket was changed by someone else.");

    assertTransition(ticket.status, input.toStatus, policyActor.roles, input.reason);

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: input.toStatus,
        ...(input.toStatus === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    });

    await Promise.all([
      tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: input.toStatus,
          changedById: actor.userId,
          reason: input.reason,
        },
      }),
      recordAuditEvent(
        {
          actorId: actor.userId,
          actorDisplayName: actor.displayName,
          action: "TICKET_STATUS_CHANGED",
          entityType: "Ticket",
          entityId: ticket.id,
          previousValue: { status: ticket.status },
          newValue: { status: input.toStatus, reason: input.reason },
        },
        tx,
      ),
    ]);

    return updated;
  });
}

export async function transferDepartment(
  actor: AuthContext,
  ticketId: string,
  version: number,
  newDepartmentKey: DepartmentKey,
  reason: string,
  newAssigneeId?: string,
) {
  const policyActor = toPolicyActor(actor);
  if (!reason?.trim())
    throw new ForbiddenError("A reason is required to transfer a ticket");

  const newDepartment = await requireActiveDepartment(newDepartmentKey);

  const result = await db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(ticketId, tx);
    assertAuthorized(
      canTransferDepartment(policyActor, ticket),
      "You cannot transfer this ticket",
    );
    if (ticket.version !== version)
      throw new ConflictError("This ticket was changed by someone else.");
    assertAuthorized(
      ACTIVE_STATUSES_FOR_TRANSFER.includes(ticket.status) ||
        ticket.status === "SUBMITTED",
      "This ticket cannot be transferred in its current status",
    );

    if (newAssigneeId) {
      const membership = await tx.departmentMembership.findUnique({
        where: {
          userId_departmentId: { userId: newAssigneeId, departmentId: newDepartment.id },
        },
      });
      assertAuthorized(
        Boolean(membership),
        "Target user is not a member of this department",
      );
    }

    // Department transfer is orthogonal to the linear status lifecycle:
    // any in-flight ticket is simply requeued (or, with a named assignee,
    // reassigned) in the new department rather than walking every
    // intermediate status-machine transition.
    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        departmentId: newDepartment.id,
        assigneeId: newAssigneeId ?? null,
        status:
          ticket.status === "SUBMITTED" || ticket.status === "IN_TRIAGE"
            ? ticket.status
            : newAssigneeId
              ? "ASSIGNED"
              : "QUEUED",
      },
    });

    const assigneeChanged = ticket.assigneeId !== updated.assigneeId;

    await Promise.all([
      tx.ticketDepartmentHistory.create({
        data: {
          ticketId: ticket.id,
          fromDepartmentId: ticket.departmentId,
          toDepartmentId: newDepartment.id,
          changedById: actor.userId,
          reason,
        },
      }),
      assigneeChanged
        ? tx.ticketAssignmentHistory.create({
            data: {
              ticketId: ticket.id,
              fromAssigneeId: ticket.assigneeId,
              toAssigneeId: updated.assigneeId,
              changedById: actor.userId,
            },
          })
        : Promise.resolve(),
      recordAuditEvent(
        {
          actorId: actor.userId,
          actorDisplayName: actor.displayName,
          action: "TICKET_DEPARTMENT_TRANSFERRED",
          entityType: "Ticket",
          entityId: ticket.id,
          previousValue: {
            departmentId: ticket.departmentId,
            assigneeId: ticket.assigneeId,
          },
          newValue: {
            departmentId: newDepartment.id,
            assigneeId: updated.assigneeId,
            reason,
          },
        },
        tx,
      ),
    ]);

    return updated;
  });

  // Deliberately after the transaction commits -- see addConversationMessage
  // above for why an external side effect (and here, a lookup outside the
  // transaction's connection) has no business inside a DB transaction.
  if (newAssigneeId) {
    const newAssignee = await db.user.findUnique({ where: { id: newAssigneeId } });
    if (newAssignee) {
      await getEmailProvider().send({
        ticketId: result.id,
        toEmail: newAssignee.email,
        subject: `[${result.ticketNumber}] Ticket transferred to you`,
        bodyText:
          `${result.ticketNumber} (${result.subject}) has been transferred to ${newDepartment.name} ` +
          `and assigned to you.\n\nReason: ${reason}`,
      });
    }
  }

  return result;
}

export interface AddConversationMessageInput {
  ticketId: string;
  version: number;
  body: string;
}

export async function addConversationMessage(
  actor: AuthContext,
  input: AddConversationMessageInput,
) {
  const policyActor = toPolicyActor(actor);

  const result = await db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(input.ticketId, tx);
    assertAuthorized(
      canAddCustomerMessage(policyActor, ticket),
      "You cannot message on this ticket",
    );
    if (ticket.version !== input.version)
      throw new ConflictError("This ticket was changed by someone else.");

    const isFromCustomer =
      ticket.submittedById === actor.userId && policyActor.roles.has("CUSTOMER");

    const message = await tx.conversationMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: actor.userId,
        isFromCustomer,
        body: input.body,
      },
    });

    let nextStatus: TicketStatus | null = null;
    if (isFromCustomer && ticket.status === "WAITING_FOR_CUSTOMER") {
      nextStatus =
        ticket.departmentId === ticket.submittedDepartmentId && ticket.assigneeId === null
          ? "IN_TRIAGE"
          : "IN_PROGRESS";
    }

    let updated = ticket;
    if (nextStatus && isTransitionAllowed(ticket.status, nextStatus, policyActor.roles)) {
      updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: { version: { increment: 1 }, status: nextStatus },
      });
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: nextStatus,
          changedById: actor.userId,
        },
      });
    }

    return { message, ticket: updated, notifyCustomer: !isFromCustomer };
  });

  // Deliberately after the transaction commits: the email provider records
  // an OutboundEmail row that references the ConversationMessage by foreign
  // key, on its own connection. Inside the transaction that row is not yet
  // visible to it, so the insert violated the constraint and rolled the
  // whole reply back -- staff could never answer a customer. External
  // side effects also have no business inside a database transaction.
  if (result.notifyCustomer) {
    await getEmailProvider().send({
      ticketId: result.ticket.id,
      conversationMessageId: result.message.id,
      toEmail: result.ticket.submittedEmail,
      subject: `[${result.ticket.ticketNumber}] ${result.ticket.subject}`,
      bodyText: input.body,
    });
  }

  return { message: result.message, ticket: result.ticket };
}

export interface AddInternalNoteInput {
  ticketId: string;
  body: string;
}

export async function addInternalNote(actor: AuthContext, input: AddInternalNoteInput) {
  const policyActor = toPolicyActor(actor);
  const ticket = await loadTicketOrThrow(input.ticketId);
  assertAuthorized(
    canAddInternalNote(policyActor, ticket),
    "You cannot add internal notes on this ticket",
  );

  return db.internalNote.create({
    data: { ticketId: ticket.id, authorId: actor.userId, body: input.body },
  });
}

export interface ResolveTicketInput {
  ticketId: string;
  version: number;
  resolutionSummary: string;
  resolutionSteps: string;
}

async function currentKnowledgeGateFacts(
  tx: Prisma.TransactionClient,
  ticket: {
    id: string;
    resolutionEnteredAt: Date | null;
    lastKnowledgeCheckAt: Date | null;
    resolutionSummary: string | null;
    resolutionSteps: string | null;
  },
) {
  const latestLink = await tx.ticketKnowledgeLink.findFirst({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "desc" },
  });

  const resolutionEnteredAt = ticket.resolutionEnteredAt ?? new Date(0);
  const hasCurrentKnowledgeCheck = Boolean(
    ticket.lastKnowledgeCheckAt && ticket.lastKnowledgeCheckAt >= resolutionEnteredAt,
  );

  return evaluateResolutionGate({
    resolutionSummary: ticket.resolutionSummary,
    resolutionSteps: ticket.resolutionSteps,
    hasCurrentKnowledgeCheck,
    knowledgeOutcome: latestLink
      ? {
          type: latestLink.outcomeType,
          isCurrent: latestLink.createdAt >= resolutionEnteredAt,
        }
      : null,
  });
}

export async function resolveTicket(actor: AuthContext, input: ResolveTicketInput) {
  const policyActor = toPolicyActor(actor);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(input.ticketId, tx);
    assertAuthorized(
      isDepartmentMember(policyActor, ticket.departmentId),
      "Not authorized for this ticket's department",
    );
    if (ticket.version !== input.version)
      throw new ConflictError("This ticket was changed by someone else.");
    assertAuthorized(
      ticket.status === "IN_PROGRESS" ||
        ticket.status === "PENDING" ||
        ticket.status === "RESOLUTION_REVIEW",
      "Ticket must be in progress before it can be resolved",
    );

    const enteringReview = ticket.status !== "RESOLUTION_REVIEW";
    if (enteringReview) {
      assertTransition(ticket.status, "RESOLUTION_REVIEW", policyActor.roles);
    }

    let updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: "RESOLUTION_REVIEW",
        resolutionSummary: input.resolutionSummary,
        resolutionSteps: input.resolutionSteps,
        resolutionEnteredAt: new Date(),
      },
    });

    if (enteringReview) {
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: "RESOLUTION_REVIEW",
          changedById: actor.userId,
        },
      });
    }

    const gate = await currentKnowledgeGateFacts(tx, updated);

    if (gate.ok) {
      updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          version: { increment: 1 },
          status: "RESOLVED",
          resolvedById: actor.userId,
          resolvedAt: new Date(),
        },
      });
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: "RESOLUTION_REVIEW",
          toStatus: "RESOLVED",
          changedById: actor.userId,
        },
      });
      await recordAuditEvent(
        {
          actorId: actor.userId,
          actorDisplayName: actor.displayName,
          action: "TICKET_RESOLVED",
          entityType: "Ticket",
          entityId: ticket.id,
        },
        tx,
      );
    }

    return { ticket: updated, gate };
  });
}

/** Re-checks the resolution gate after a knowledge outcome is recorded post-hoc. */
export async function retryResolutionAfterKnowledgeOutcome(
  actor: AuthContext,
  ticketId: string,
) {
  const policyActor = toPolicyActor(actor);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(ticketId, tx);
    // Department members re-attempt resolution after linking/drafting an
    // article themselves; a Knowledge Manager/Administrator re-attempts it
    // as the direct consequence of approving an EXCEPTION outcome (Section
    // 11.3) without necessarily belonging to the ticket's department.
    assertAuthorized(
      isDepartmentMember(policyActor, ticket.departmentId) ||
        isKnowledgeManager(policyActor),
      "Not authorized for this ticket's department",
    );
    if (ticket.status !== "RESOLUTION_REVIEW") return { ticket, gate: null };

    const gate = await currentKnowledgeGateFacts(tx, ticket);
    if (!gate.ok) return { ticket, gate };

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: "RESOLVED",
        resolvedById: actor.userId,
        resolvedAt: new Date(),
      },
    });
    await tx.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: "RESOLUTION_REVIEW",
        toStatus: "RESOLVED",
        changedById: actor.userId,
      },
    });
    await recordAuditEvent(
      {
        actorId: actor.userId,
        actorDisplayName: actor.displayName,
        action: "TICKET_RESOLVED",
        entityType: "Ticket",
        entityId: ticket.id,
      },
      tx,
    );

    return { ticket: updated, gate };
  });
}
