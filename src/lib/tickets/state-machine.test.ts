import { describe, expect, it } from "vitest";
import {
  assertTransition,
  getAllowedNextStatuses,
  InvalidTransitionError,
  isTransitionAllowed,
  transitionRequiresReason,
} from "./state-machine";

describe("ticket state machine", () => {
  it("allows triage to move a submitted ticket into triage", () => {
    expect(isTransitionAllowed("SUBMITTED", "IN_TRIAGE", ["TRIAGE_AGENT"])).toBe(true);
  });

  it("rejects a customer confirming triage", () => {
    expect(isTransitionAllowed("SUBMITTED", "IN_TRIAGE", ["CUSTOMER"])).toBe(false);
  });

  it("rejects transitions that skip required steps", () => {
    expect(isTransitionAllowed("SUBMITTED", "RESOLVED", ["ADMINISTRATOR"])).toBe(false);
    expect(isTransitionAllowed("QUEUED", "RESOLVED", ["DEPARTMENT_AGENT"])).toBe(false);
  });

  it("rejects an unknown/reversed transition", () => {
    expect(isTransitionAllowed("RESOLVED", "SUBMITTED", ["ADMINISTRATOR"])).toBe(false);
  });

  it("requires a reason for cancellation, reopen, and only those", () => {
    expect(transitionRequiresReason("IN_PROGRESS", "CANCELLED")).toBe(true);
    expect(transitionRequiresReason("RESOLVED", "REOPENED")).toBe(true);
    expect(transitionRequiresReason("CLOSED", "REOPENED")).toBe(true);
    expect(transitionRequiresReason("QUEUED", "ASSIGNED")).toBe(false);
  });

  it("throws InvalidTransitionError for a disallowed transition", () => {
    expect(() => assertTransition("SUBMITTED", "RESOLVED", ["ADMINISTRATOR"])).toThrow(
      InvalidTransitionError,
    );
  });

  it("throws when a reason-required transition has no reason", () => {
    expect(() => assertTransition("IN_PROGRESS", "CANCELLED", ["ADMINISTRATOR"])).toThrow(
      /reason is required/i,
    );
    expect(() =>
      assertTransition(
        "IN_PROGRESS",
        "CANCELLED",
        ["ADMINISTRATOR"],
        "duplicate of SD-1",
      ),
    ).not.toThrow();
  });

  it("lets a customer reopen their own resolved ticket with a reason", () => {
    expect(isTransitionAllowed("RESOLVED", "REOPENED", ["CUSTOMER"])).toBe(true);
  });

  it("blocks a plain department agent from cancelling a ticket", () => {
    expect(isTransitionAllowed("IN_PROGRESS", "CANCELLED", ["DEPARTMENT_AGENT"])).toBe(
      false,
    );
    expect(isTransitionAllowed("IN_PROGRESS", "CANCELLED", ["DEPARTMENT_MANAGER"])).toBe(
      true,
    );
  });

  it("computes the allowed next statuses for a role from a given status", () => {
    const next = getAllowedNextStatuses("IN_PROGRESS", ["DEPARTMENT_AGENT"]);
    expect(next.sort()).toEqual(
      ["PENDING", "RESOLUTION_REVIEW", "WAITING_FOR_CUSTOMER"].sort(),
    );
  });

  it("only reaches RESOLVED via RESOLUTION_REVIEW", () => {
    expect(
      isTransitionAllowed("RESOLUTION_REVIEW", "RESOLVED", ["DEPARTMENT_AGENT"]),
    ).toBe(true);
    expect(isTransitionAllowed("IN_PROGRESS", "RESOLVED", ["DEPARTMENT_AGENT"])).toBe(
      false,
    );
  });
});
