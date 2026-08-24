import { describe, expect, it } from "vitest";
import type { RoleName } from "@prisma/client";
import {
  canAddCustomerMessage,
  canAddInternalNote,
  canArchiveArticle,
  canCreateTicket,
  canDraftOrLinkKnowledge,
  canPublishArticle,
  canReassign,
  canRecordKnowledgeException,
  canSelfAssign,
  canSetArticleVisibility,
  canTransferDepartment,
  canViewDepartmentQueue,
  canViewDepartmentWorkload,
  canViewInternalNotes,
  canViewKnowledgeArticle,
  canViewTicket,
  type PolicyActor,
} from "./policies";

const TECH = "dept-tech";
const TRAINING = "dept-training";

function actor(
  roles: RoleName[],
  departments: Array<[string, boolean]> = [],
  userId = "u1",
): PolicyActor {
  return { userId, roles: new Set(roles), departments: new Map(departments) };
}

const ticketOwnedByU1 = {
  submittedById: "u1",
  departmentId: TECH,
  status: "IN_PROGRESS",
};
const ticketOwnedByOther = {
  submittedById: "u2",
  departmentId: TECH,
  status: "IN_PROGRESS",
};

describe("customer access", () => {
  it("lets a customer create tickets", () => {
    expect(canCreateTicket(actor(["CUSTOMER"]))).toBe(true);
  });

  it("blocks ticket creation for a non-customer role", () => {
    expect(canCreateTicket(actor(["DEPARTMENT_AGENT"]))).toBe(false);
  });

  it("lets a customer view only their own ticket", () => {
    const c = actor(["CUSTOMER"]);
    expect(canViewTicket(c, ticketOwnedByU1)).toBe(true);
    expect(canViewTicket(c, ticketOwnedByOther)).toBe(false);
  });

  it("never lets a customer see internal notes, even on their own ticket", () => {
    const c = actor(["CUSTOMER"]);
    expect(canViewInternalNotes(c, ticketOwnedByU1)).toBe(false);
  });

  it("blocks a customer from messaging a closed ticket", () => {
    const c = actor(["CUSTOMER"]);
    expect(canAddCustomerMessage(c, { ...ticketOwnedByU1, status: "CLOSED" })).toBe(
      false,
    );
  });
});

describe("triage access", () => {
  it("lets triage view any ticket regardless of department", () => {
    const t = actor(["TRIAGE_AGENT"]);
    expect(canViewTicket(t, ticketOwnedByOther)).toBe(true);
    expect(canViewTicket(t, { ...ticketOwnedByOther, departmentId: TRAINING })).toBe(
      true,
    );
  });

  it("lets triage transfer department on any ticket", () => {
    const t = actor(["TRIAGE_AGENT"]);
    expect(canTransferDepartment(t, ticketOwnedByOther)).toBe(true);
  });
});

describe("department scoping", () => {
  it("blocks a department agent from another department's ticket", () => {
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    expect(canViewTicket(agent, ticketOwnedByOther)).toBe(true);
    expect(canViewTicket(agent, { ...ticketOwnedByOther, departmentId: TRAINING })).toBe(
      false,
    );
  });

  it("lets a department agent self-assign within their department only", () => {
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    expect(canSelfAssign(agent, ticketOwnedByOther)).toBe(true);
    expect(canSelfAssign(agent, { ...ticketOwnedByOther, departmentId: TRAINING })).toBe(
      false,
    );
  });

  it("blocks a plain agent from reassigning to someone else", () => {
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    expect(canReassign(agent, ticketOwnedByOther)).toBe(false);
  });

  it("lets a department manager reassign within their managed department", () => {
    const manager = actor(["DEPARTMENT_MANAGER"], [[TECH, true]]);
    expect(canReassign(manager, ticketOwnedByOther)).toBe(true);
    expect(canReassign(manager, { ...ticketOwnedByOther, departmentId: TRAINING })).toBe(
      false,
    );
  });

  it("scopes department queue and workload views to membership/management", () => {
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    const manager = actor(["DEPARTMENT_MANAGER"], [[TECH, true]]);
    expect(canViewDepartmentQueue(agent, TECH)).toBe(true);
    expect(canViewDepartmentQueue(agent, TRAINING)).toBe(false);
    expect(canViewDepartmentWorkload(agent, TECH)).toBe(false);
    expect(canViewDepartmentWorkload(manager, TECH)).toBe(true);
  });

  it("lets an administrator bypass department scoping", () => {
    const admin = actor(["ADMINISTRATOR"]);
    expect(canViewTicket(admin, ticketOwnedByOther)).toBe(true);
    expect(canReassign(admin, { ...ticketOwnedByOther, departmentId: TRAINING })).toBe(
      true,
    );
    expect(canAddInternalNote(admin, ticketOwnedByOther)).toBe(true);
  });
});

describe("knowledge base access", () => {
  it("lets anyone view a published article", () => {
    const c = actor(["CUSTOMER"]);
    expect(canViewKnowledgeArticle(c, { departmentId: TECH, status: "PUBLISHED" })).toBe(
      true,
    );
  });

  it("blocks a customer from an unpublished article", () => {
    const c = actor(["CUSTOMER"]);
    expect(canViewKnowledgeArticle(c, { departmentId: TECH, status: "DRAFT" })).toBe(
      false,
    );
  });

  it("lets a department agent view drafts (for authoring/linking) but not publish them", () => {
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    expect(canDraftOrLinkKnowledge(agent)).toBe(true);
    expect(canViewKnowledgeArticle(agent, { departmentId: TECH, status: "DRAFT" })).toBe(
      true,
    );
    expect(canPublishArticle(agent)).toBe(false);
  });

  it("restricts publish/archive/exception approval to knowledge managers and admins", () => {
    const km = actor(["KNOWLEDGE_MANAGER"]);
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    expect(canPublishArticle(km)).toBe(true);
    expect(canArchiveArticle(km)).toBe(true);
    expect(canRecordKnowledgeException(km)).toBe(true);
    expect(canPublishArticle(agent)).toBe(false);
    expect(canRecordKnowledgeException(agent)).toBe(false);
  });

  it("blocks a customer from a published internal-only article", () => {
    const c = actor(["CUSTOMER"]);
    expect(
      canViewKnowledgeArticle(c, {
        departmentId: TECH,
        status: "PUBLISHED",
        internalOnly: true,
      }),
    ).toBe(false);
  });

  it("lets internal staff view a published internal-only article", () => {
    const triage = actor(["TRIAGE_AGENT"]);
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    const manager = actor(["DEPARTMENT_MANAGER"], [[TECH, true]]);
    const km = actor(["KNOWLEDGE_MANAGER"]);
    const shape = {
      departmentId: TECH,
      status: "PUBLISHED" as const,
      internalOnly: true,
    };
    expect(canViewKnowledgeArticle(triage, shape)).toBe(true);
    expect(canViewKnowledgeArticle(agent, shape)).toBe(true);
    expect(canViewKnowledgeArticle(manager, shape)).toBe(true);
    expect(canViewKnowledgeArticle(km, shape)).toBe(true);
  });

  it("restricts changing article visibility to knowledge managers and admins", () => {
    const km = actor(["KNOWLEDGE_MANAGER"]);
    const admin = actor(["ADMINISTRATOR"]);
    const agent = actor(["DEPARTMENT_AGENT"], [[TECH, false]]);
    expect(canSetArticleVisibility(km)).toBe(true);
    expect(canSetArticleVisibility(admin)).toBe(true);
    expect(canSetArticleVisibility(agent)).toBe(false);
  });
});
