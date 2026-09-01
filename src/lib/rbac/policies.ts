import type { RoleName } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";

/**
 * Minimal shapes so these policies can be unit tested without touching the
 * database or Auth.js at all (Section 17: "Cover: Role and department
 * policies").
 */
export interface PolicyActor {
  userId: string;
  roles: Set<RoleName>;
  /** departmentId -> isManager */
  departments: Map<string, boolean>;
}

export function toPolicyActor(ctx: AuthContext): PolicyActor {
  return { userId: ctx.userId, roles: ctx.roles, departments: ctx.departments };
}

export interface TicketAccessShape {
  submittedById: string;
  departmentId: string;
  status: string;
  assigneeId: string | null;
}

export interface KnowledgeAccessShape {
  departmentId: string;
  status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  internalOnly?: boolean;
}

const CLOSED_LIKE_STATUSES = new Set(["CLOSED", "CANCELLED"]);

export const isAdministrator = (actor: PolicyActor): boolean =>
  actor.roles.has("ADMINISTRATOR");
export const isKnowledgeManager = (actor: PolicyActor): boolean =>
  actor.roles.has("KNOWLEDGE_MANAGER") || isAdministrator(actor);
export const isTriageAgent = (actor: PolicyActor): boolean =>
  actor.roles.has("TRIAGE_AGENT") || isAdministrator(actor);
export const isCustomer = (actor: PolicyActor): boolean => actor.roles.has("CUSTOMER");

export function isDepartmentMember(actor: PolicyActor, departmentId: string): boolean {
  return isAdministrator(actor) || actor.departments.has(departmentId);
}

export function isDepartmentManager(actor: PolicyActor, departmentId: string): boolean {
  return isAdministrator(actor) || actor.departments.get(departmentId) === true;
}

export function isDepartmentAgentRole(actor: PolicyActor): boolean {
  return actor.roles.has("DEPARTMENT_AGENT") || actor.roles.has("DEPARTMENT_MANAGER");
}

export function canCreateTicket(actor: PolicyActor): boolean {
  return isCustomer(actor);
}

export function canViewTicket(actor: PolicyActor, ticket: TicketAccessShape): boolean {
  if (isAdministrator(actor)) return true;
  if (isCustomer(actor) && ticket.submittedById === actor.userId) return true;
  if (isTriageAgent(actor)) return true;
  if (isDepartmentAgentRole(actor) && isDepartmentMember(actor, ticket.departmentId))
    return true;
  return false;
}

export function canViewInternalNotes(
  actor: PolicyActor,
  ticket: TicketAccessShape,
): boolean {
  if (isAdministrator(actor)) return true;
  if (isTriageAgent(actor)) return true;
  if (isDepartmentAgentRole(actor) && isDepartmentMember(actor, ticket.departmentId))
    return true;
  return false;
}

export function canAddInternalNote(
  actor: PolicyActor,
  ticket: TicketAccessShape,
): boolean {
  return canViewInternalNotes(actor, ticket);
}

export function canAddCustomerMessage(
  actor: PolicyActor,
  ticket: TicketAccessShape,
): boolean {
  if (CLOSED_LIKE_STATUSES.has(ticket.status)) return false;
  if (isCustomer(actor) && ticket.submittedById === actor.userId) return true;
  return canViewInternalNotes(actor, ticket);
}

export function canTriageTicket(actor: PolicyActor): boolean {
  return isTriageAgent(actor);
}

export function canTransferDepartment(
  actor: PolicyActor,
  ticket: TicketAccessShape,
): boolean {
  if (isAdministrator(actor) || isTriageAgent(actor)) return true;
  if (ticket.assigneeId === actor.userId) return true;
  return isDepartmentManager(actor, ticket.departmentId);
}

export function canSelfAssign(actor: PolicyActor, ticket: TicketAccessShape): boolean {
  return isDepartmentAgentRole(actor) && isDepartmentMember(actor, ticket.departmentId);
}

export function canReassign(actor: PolicyActor, ticket: TicketAccessShape): boolean {
  return isAdministrator(actor) || isDepartmentManager(actor, ticket.departmentId);
}

export function canViewDepartmentQueue(
  actor: PolicyActor,
  departmentId: string,
): boolean {
  return isDepartmentAgentRole(actor) && isDepartmentMember(actor, departmentId);
}

export function canViewDepartmentWorkload(
  actor: PolicyActor,
  departmentId: string,
): boolean {
  return isDepartmentManager(actor, departmentId);
}

export function canDraftOrLinkKnowledge(actor: PolicyActor): boolean {
  return (
    isAdministrator(actor) ||
    isKnowledgeManager(actor) ||
    isTriageAgent(actor) ||
    isDepartmentAgentRole(actor)
  );
}

export function canViewKnowledgeArticle(
  actor: PolicyActor,
  article: KnowledgeAccessShape,
): boolean {
  if (article.status !== "PUBLISHED") {
    // Draft/in-review/archived content is internal-only.
    return canDraftOrLinkKnowledge(actor) || isKnowledgeManager(actor);
  }
  if (article.internalOnly) return canDraftOrLinkKnowledge(actor);
  return true;
}

export function canPublishArticle(actor: PolicyActor): boolean {
  return isKnowledgeManager(actor);
}

export function canArchiveArticle(actor: PolicyActor): boolean {
  return isKnowledgeManager(actor);
}

export function canRecordKnowledgeException(actor: PolicyActor): boolean {
  return isKnowledgeManager(actor);
}

export function canSetArticleVisibility(actor: PolicyActor): boolean {
  return isKnowledgeManager(actor);
}

export function canAdminister(actor: PolicyActor): boolean {
  return isAdministrator(actor);
}

export function canViewAuditEvents(actor: PolicyActor): boolean {
  return isAdministrator(actor);
}

export function canManageNotificationPreferences(actor: PolicyActor): boolean {
  return (
    isAdministrator(actor) ||
    isKnowledgeManager(actor) ||
    isTriageAgent(actor) ||
    isDepartmentAgentRole(actor)
  );
}

export function isManagerOfAnyDepartment(actor: PolicyActor): boolean {
  return isAdministrator(actor) || [...actor.departments.values()].some(Boolean);
}

export function canViewTeamReports(actor: PolicyActor): boolean {
  return isManagerOfAnyDepartment(actor);
}

export function canViewKnowledgeReports(actor: PolicyActor): boolean {
  return isKnowledgeManager(actor);
}

export function canDownloadAttachment(
  actor: PolicyActor,
  ticket: TicketAccessShape,
): boolean {
  return canViewTicket(actor, ticket);
}
