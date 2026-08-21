import type {
  DepartmentKey,
  KnowledgeOutcomeType,
  Prisma,
  PrismaClient,
  RoleName,
  TicketPriority,
  TicketStatus,
} from "@prisma/client";
import { assertAuthorized, ConflictError, NotFoundError } from "@/lib/rbac/errors";
import {
  canAddCustomerMessage,
  canAddInternalNote,
  canCreateTicket,
  canDraftOrLinkKnowledge,
  canRecordKnowledgeException,
  canReassign,
  canSelfAssign,
  canTriageTicket,
  isDepartmentMember,
} from "@/lib/rbac/policies";
import { assertTransition, isTransitionAllowed } from "@/lib/tickets/state-machine";
import { suggestDepartment } from "@/lib/tickets/department-suggestion";
import { evaluateResolutionGate } from "@/lib/knowledge/resolution-gate";

/**
 * Mirrors the transaction bodies of src/lib/tickets/ticket-service.ts and
 * src/lib/knowledge/knowledge-service.ts for use from scripts/sim-run.ts.
 *
 * Those modules (and several of their helpers: ticket-number.ts,
 * department-lookup.ts, similarity.ts, audit-log.ts) start with
 * `import "server-only"`, which throws unconditionally unless the bundler
 * resolves the package's `react-server` export condition (only Next.js's
 * RSC webpack config does that) -- see node_modules/server-only/index.js.
 * A standalone tsx script has no such bundler, so importing them directly
 * throws immediately. This is also why prisma/seed.ts writes tickets with
 * raw `db.ticket.create` instead of calling ticket-service.ts.
 *
 * The actual decision logic -- state transitions, RBAC authorization, the
 * resolution gate -- is still delegated to the real, unguarded pure modules
 * (state-machine.ts, rbac/policies.ts, resolution-gate.ts,
 * department-suggestion.ts) so a scripted persona doing something outside
 * its real permissions still throws. Only the DB-mutation shape below is
 * duplicated, and is kept in lockstep with the two service modules it
 * mirrors.
 */

export interface SimActor {
  userId: string;
  displayName: string;
  email: string;
  roles: Set<RoleName>;
  departments: Map<string, boolean>;
}

type Executor = PrismaClient | Prisma.TransactionClient;

async function simRecordAuditEvent(
  tx: Executor,
  input: {
    actorId: string;
    actorDisplayName: string;
    action: string;
    entityType: string;
    entityId: string;
    previousValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
  },
) {
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      actorDisplayName: input.actorDisplayName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      previousValue: (input.previousValue ?? undefined) as Prisma.InputJsonValue,
      newValue: (input.newValue ?? undefined) as Prisma.InputJsonValue,
    },
  });
}

async function simNextTicketNumber(tx: Executor): Promise<string> {
  const counter = await tx.ticketNumberCounter.upsert({
    where: { id: 1 },
    create: { id: 1, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `SD-${String(counter.value).padStart(6, "0")}`;
}

async function simRequireActiveDepartment(db: PrismaClient, key: DepartmentKey) {
  const department = await db.department.findUnique({ where: { key } });
  if (!department || !department.isActive) {
    throw new NotFoundError(`Department "${key}" is not available`);
  }
  return department;
}

async function loadTicketOrThrow(tx: Executor, ticketId: string) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new NotFoundError("Ticket not found");
  return ticket;
}

export interface SimCreateTicketInput {
  franchiseId: string;
  subject: string;
  description: string;
  departmentKey: DepartmentKey;
}

export async function simCreateTicket(db: PrismaClient, actor: SimActor, input: SimCreateTicketInput) {
  const policyActor = toSimPolicyActor(actor);
  assertAuthorized(canCreateTicket(policyActor), "Only customers can submit tickets");

  const department = await simRequireActiveDepartment(db, input.departmentKey);
  const suggestion = suggestDepartment(input.subject, input.description);
  let suggestedDepartmentId: string | null = null;
  if (suggestion && suggestion.departmentKey !== input.departmentKey) {
    const suggestedDept = await db.department.findUnique({ where: { key: suggestion.departmentKey } });
    suggestedDepartmentId = suggestedDept?.id ?? null;
  }

  return db.$transaction(async (tx) => {
    const ticketNumber = await simNextTicketNumber(tx);
    const created = await tx.ticket.create({
      data: {
        ticketNumber,
        submittedById: actor.userId,
        submittedName: actor.displayName,
        submittedEmail: actor.email,
        franchiseId: input.franchiseId,
        subject: input.subject,
        description: input.description,
        submittedDepartmentId: department.id,
        departmentId: department.id,
        suggestedDepartmentId,
        suggestedDepartmentRationale: suggestion?.rationale,
        status: "SUBMITTED",
      },
    });

    await tx.ticketStatusHistory.create({
      data: { ticketId: created.id, fromStatus: null, toStatus: "SUBMITTED", changedById: actor.userId },
    });
    await simRecordAuditEvent(tx, {
      actorId: actor.userId,
      actorDisplayName: actor.displayName,
      action: "TICKET_CREATED",
      entityType: "Ticket",
      entityId: created.id,
      newValue: { ticketNumber, departmentId: department.id },
    });

    return created;
  });
}

export interface SimConfirmTriageInput {
  ticketId: string;
  version: number;
  departmentKey: DepartmentKey;
  category: string;
  priority: TicketPriority;
}

export async function simConfirmTriage(db: PrismaClient, actor: SimActor, input: SimConfirmTriageInput) {
  const policyActor = toSimPolicyActor(actor);
  assertAuthorized(canTriageTicket(policyActor), "Triage access required");
  const targetDepartment = await simRequireActiveDepartment(db, input.departmentKey);

  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, input.ticketId);
    if (ticket.version !== input.version) throw new ConflictError("Ticket changed by someone else.");
    assertAuthorized(ticket.status === "SUBMITTED" || ticket.status === "IN_TRIAGE", "Ticket is not awaiting triage");

    const previousDepartmentId = ticket.departmentId;

    if (ticket.status === "SUBMITTED") {
      assertTransition("SUBMITTED", "IN_TRIAGE", policyActor.roles);
      await tx.ticketStatusHistory.create({
        data: { ticketId: ticket.id, fromStatus: "SUBMITTED", toStatus: "IN_TRIAGE", changedById: actor.userId },
      });
    }
    assertTransition("IN_TRIAGE", "QUEUED", policyActor.roles);

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: "QUEUED",
        departmentId: targetDepartment.id,
        category: input.category,
        priority: input.priority,
      },
    });

    await tx.ticketStatusHistory.create({
      data: { ticketId: ticket.id, fromStatus: "IN_TRIAGE", toStatus: "QUEUED", changedById: actor.userId },
    });

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

    await simRecordAuditEvent(tx, {
      actorId: actor.userId,
      actorDisplayName: actor.displayName,
      action: "TICKET_TRIAGE_CONFIRMED",
      entityType: "Ticket",
      entityId: ticket.id,
      newValue: { departmentId: targetDepartment.id, priority: input.priority, category: input.category },
    });

    return updated;
  });
}

export async function simSelfAssignTicket(db: PrismaClient, actor: SimActor, ticketId: string, version: number) {
  const policyActor = toSimPolicyActor(actor);
  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, ticketId);
    assertAuthorized(canSelfAssign(policyActor, ticket), "Cannot self-assign this ticket");
    if (ticket.version !== version) throw new ConflictError("Ticket changed by someone else.");
    assertAuthorized(ticket.status === "QUEUED", "Ticket is not in the queue");
    assertTransition("QUEUED", "ASSIGNED", policyActor.roles);

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { version: { increment: 1 }, status: "ASSIGNED", assigneeId: actor.userId },
    });
    await tx.ticketStatusHistory.create({
      data: { ticketId: ticket.id, fromStatus: "QUEUED", toStatus: "ASSIGNED", changedById: actor.userId },
    });
    await tx.ticketAssignmentHistory.create({
      data: { ticketId: ticket.id, fromAssigneeId: null, toAssigneeId: actor.userId, changedById: actor.userId },
    });
    await simRecordAuditEvent(tx, {
      actorId: actor.userId,
      actorDisplayName: actor.displayName,
      action: "TICKET_SELF_ASSIGNED",
      entityType: "Ticket",
      entityId: ticket.id,
      newValue: { assigneeId: actor.userId },
    });

    return updated;
  });
}

export async function simReassignTicket(
  db: PrismaClient,
  actor: SimActor,
  ticketId: string,
  version: number,
  targetUserId: string,
) {
  const policyActor = toSimPolicyActor(actor);
  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, ticketId);
    assertAuthorized(canReassign(policyActor, ticket), "Cannot reassign this ticket");
    if (ticket.version !== version) throw new ConflictError("Ticket changed by someone else.");

    const membership = await tx.departmentMembership.findUnique({
      where: { userId_departmentId: { userId: targetUserId, departmentId: ticket.departmentId } },
    });
    assertAuthorized(Boolean(membership), "Target user is not a member of this department");

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        version: { increment: 1 },
        status: ticket.status === "QUEUED" ? "ASSIGNED" : ticket.status,
        assigneeId: targetUserId,
      },
    });
    await tx.ticketAssignmentHistory.create({
      data: {
        ticketId: ticket.id,
        fromAssigneeId: ticket.assigneeId,
        toAssigneeId: targetUserId,
        changedById: actor.userId,
      },
    });
    await simRecordAuditEvent(tx, {
      actorId: actor.userId,
      actorDisplayName: actor.displayName,
      action: "TICKET_REASSIGNED",
      entityType: "Ticket",
      entityId: ticket.id,
      previousValue: { assigneeId: ticket.assigneeId },
      newValue: { assigneeId: targetUserId },
    });

    return updated;
  });
}

export interface SimTransitionInput {
  ticketId: string;
  version: number;
  toStatus: TicketStatus;
  reason?: string;
}

export async function simTransitionTicketStatus(db: PrismaClient, actor: SimActor, input: SimTransitionInput) {
  const policyActor = toSimPolicyActor(actor);
  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, input.ticketId);
    if (ticket.version !== input.version) throw new ConflictError("Ticket changed by someone else.");
    assertTransition(ticket.status, input.toStatus, policyActor.roles, input.reason);

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { version: { increment: 1 }, status: input.toStatus },
    });
    await tx.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: input.toStatus,
        changedById: actor.userId,
        reason: input.reason,
      },
    });
    await simRecordAuditEvent(tx, {
      actorId: actor.userId,
      actorDisplayName: actor.displayName,
      action: "TICKET_STATUS_CHANGED",
      entityType: "Ticket",
      entityId: ticket.id,
      previousValue: { status: ticket.status },
      newValue: { status: input.toStatus, reason: input.reason },
    });

    return updated;
  });
}

export interface SimAddConversationMessageInput {
  ticketId: string;
  version: number;
  body: string;
}

export async function simAddConversationMessage(
  db: PrismaClient,
  actor: SimActor,
  input: SimAddConversationMessageInput,
) {
  const policyActor = toSimPolicyActor(actor);
  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, input.ticketId);
    assertAuthorized(canAddCustomerMessage(policyActor, ticket), "Cannot message on this ticket");
    if (ticket.version !== input.version) throw new ConflictError("Ticket changed by someone else.");

    const isFromCustomer = ticket.submittedById === actor.userId && policyActor.roles.has("CUSTOMER");
    const message = await tx.conversationMessage.create({
      data: { ticketId: ticket.id, authorId: actor.userId, isFromCustomer, body: input.body },
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
        data: { ticketId: ticket.id, fromStatus: ticket.status, toStatus: nextStatus, changedById: actor.userId },
      });
    }

    return { message, ticket: updated };
  });
}

export async function simAddInternalNote(db: PrismaClient, actor: SimActor, ticketId: string, body: string) {
  const policyActor = toSimPolicyActor(actor);
  const ticket = await loadTicketOrThrow(db, ticketId);
  assertAuthorized(canAddInternalNote(policyActor, ticket), "Cannot add internal notes on this ticket");
  return db.internalNote.create({ data: { ticketId: ticket.id, authorId: actor.userId, body } });
}

export interface SimResolveTicketInput {
  ticketId: string;
  version: number;
  resolutionSummary: string;
  resolutionSteps: string;
}

async function currentKnowledgeGateFacts(
  tx: Executor,
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
      ? { type: latestLink.outcomeType, isCurrent: latestLink.createdAt >= resolutionEnteredAt }
      : null,
  });
}

export async function simResolveTicket(db: PrismaClient, actor: SimActor, input: SimResolveTicketInput) {
  const policyActor = toSimPolicyActor(actor);
  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, input.ticketId);
    assertAuthorized(isDepartmentMember(policyActor, ticket.departmentId), "Not authorized for this department");
    if (ticket.version !== input.version) throw new ConflictError("Ticket changed by someone else.");
    assertAuthorized(
      ticket.status === "IN_PROGRESS" || ticket.status === "PENDING" || ticket.status === "RESOLUTION_REVIEW",
      "Ticket must be in progress before it can be resolved",
    );

    const enteringReview = ticket.status !== "RESOLUTION_REVIEW";
    if (enteringReview) assertTransition(ticket.status, "RESOLUTION_REVIEW", policyActor.roles);

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
        data: { ticketId: ticket.id, fromStatus: ticket.status, toStatus: "RESOLUTION_REVIEW", changedById: actor.userId },
      });
    }

    const gate = await currentKnowledgeGateFacts(tx, updated);
    if (gate.ok) {
      updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: { version: { increment: 1 }, status: "RESOLVED", resolvedById: actor.userId, resolvedAt: new Date() },
      });
      await tx.ticketStatusHistory.create({
        data: { ticketId: ticket.id, fromStatus: "RESOLUTION_REVIEW", toStatus: "RESOLVED", changedById: actor.userId },
      });
      await simRecordAuditEvent(tx, {
        actorId: actor.userId,
        actorDisplayName: actor.displayName,
        action: "TICKET_RESOLVED",
        entityType: "Ticket",
        entityId: ticket.id,
      });
    }

    return { ticket: updated, gate };
  });
}

export async function simRetryResolutionAfterKnowledgeOutcome(db: PrismaClient, actor: SimActor, ticketId: string) {
  const policyActor = toSimPolicyActor(actor);
  return db.$transaction(async (tx) => {
    const ticket = await loadTicketOrThrow(tx, ticketId);
    assertAuthorized(
      isDepartmentMember(policyActor, ticket.departmentId) || policyActor.roles.has("KNOWLEDGE_MANAGER") || policyActor.roles.has("ADMINISTRATOR"),
      "Not authorized for this department",
    );
    if (ticket.status !== "RESOLUTION_REVIEW") return { ticket, gate: null };

    const gate = await currentKnowledgeGateFacts(tx, ticket);
    if (!gate.ok) return { ticket, gate };

    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: { version: { increment: 1 }, status: "RESOLVED", resolvedById: actor.userId, resolvedAt: new Date() },
    });
    await tx.ticketStatusHistory.create({
      data: { ticketId: ticket.id, fromStatus: "RESOLUTION_REVIEW", toStatus: "RESOLVED", changedById: actor.userId },
    });
    await simRecordAuditEvent(tx, {
      actorId: actor.userId,
      actorDisplayName: actor.displayName,
      action: "TICKET_RESOLVED",
      entityType: "Ticket",
      entityId: ticket.id,
    });

    return { ticket: updated, gate };
  });
}

export interface SimRecordSimilarityCheckInput {
  ticketId: string;
  performedById: string;
  normalizedQuery: string;
  candidateArticleIds: string[];
}

export async function simRecordSimilarityCheck(db: PrismaClient, input: SimRecordSimilarityCheckInput) {
  const check = await db.knowledgeSimilarityCheck.create({
    data: {
      ticketId: input.ticketId,
      performedById: input.performedById,
      normalizedQuery: input.normalizedQuery,
      candidateArticleIds: input.candidateArticleIds,
    },
  });
  await db.ticket.update({ where: { id: input.ticketId }, data: { lastKnowledgeCheckAt: new Date() } });
  return check;
}

export interface SimRecordKnowledgeOutcomeInput {
  ticketId: string;
  articleId?: string;
  outcomeType: KnowledgeOutcomeType;
  reason?: string;
}

export async function simRecordKnowledgeOutcome(db: PrismaClient, actor: SimActor, input: SimRecordKnowledgeOutcomeInput) {
  const policyActor = toSimPolicyActor(actor);

  if (input.outcomeType === "EXCEPTION") {
    assertAuthorized(canRecordKnowledgeException(policyActor), "Only a knowledge manager can approve an exception");
    assertAuthorized(Boolean(input.reason?.trim()), "A reason is required to record a knowledge exception");
  } else {
    assertAuthorized(canDraftOrLinkKnowledge(policyActor), "Cannot record a knowledge outcome");
    assertAuthorized(Boolean(input.articleId), "An article must be selected for this outcome");
  }

  const link = await db.ticketKnowledgeLink.create({
    data: {
      ticketId: input.ticketId,
      articleId: input.articleId ?? null,
      outcomeType: input.outcomeType,
      createdById: actor.userId,
      reason: input.reason,
    },
  });
  await simRecordAuditEvent(db, {
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "TICKET_KNOWLEDGE_OUTCOME_RECORDED",
    entityType: "Ticket",
    entityId: input.ticketId,
    newValue: { outcomeType: input.outcomeType, articleId: input.articleId, reason: input.reason },
  });

  const gateResult = await simRetryResolutionAfterKnowledgeOutcome(db, actor, input.ticketId);
  return { link, gateResult };
}

function toSimPolicyActor(actor: SimActor) {
  return { userId: actor.userId, roles: actor.roles, departments: actor.departments };
}
