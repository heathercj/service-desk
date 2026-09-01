/**
 * Pure fold logic for the team metrics report, exercised in isolation
 * from the database. The DB-backed query shape is covered by
 * team-report-service.integration.test.ts; this file is about getting
 * the counting semantics right -- distinct tickets (not assignment
 * events), attribution via resolution events (not the mutable
 * Ticket.resolvedAt/resolvedById columns), and agents who are no longer
 * in the department but had activity in the period.
 */
import { describe, expect, it } from "vitest";
import { foldTeamMetrics } from "./team-report-service";

const HOUR_MS = 3_600_000;

describe("foldTeamMetrics", () => {
  it("counts a ticket bounced between agents once each, not once per event", () => {
    const rows = foldTeamMetrics(
      new Set(["alice", "bob"]),
      new Map([
        ["alice", "Alice Agent"],
        ["bob", "Bob Agent"],
      ]),
      [
        { ticketId: "t1", toAssigneeId: "alice" },
        { ticketId: "t1", toAssigneeId: "bob" },
        { ticketId: "t1", toAssigneeId: "alice" }, // ping-ponged back
        { ticketId: "t2", toAssigneeId: "alice" },
      ],
      [],
    );
    const alice = rows.find((r) => r.agentId === "alice")!;
    const bob = rows.find((r) => r.agentId === "bob")!;
    expect(alice.assignedCount).toBe(2); // t1, t2 -- not 3 events
    expect(bob.assignedCount).toBe(1);
  });

  it("drops assignment rows with a null toAssigneeId (a department transfer clearing the assignee)", () => {
    const rows = foldTeamMetrics(
      new Set(["alice"]),
      new Map([["alice", "Alice Agent"]]),
      [
        { ticketId: "t1", toAssigneeId: "alice" },
        { ticketId: "t2", toAssigneeId: null },
      ],
      [],
    );
    expect(rows.find((r) => r.agentId === "alice")!.assignedCount).toBe(1);
    expect(rows.some((r) => r.agentId === null)).toBe(false);
  });

  it("gives an agent with zero activity a null average, not 0 or NaN", () => {
    const rows = foldTeamMetrics(
      new Set(["alice"]),
      new Map([["alice", "Alice Agent"]]),
      [],
      [],
    );
    const alice = rows.find((r) => r.agentId === "alice")!;
    expect(alice.assignedCount).toBe(0);
    expect(alice.resolvedCount).toBe(0);
    expect(alice.avgResolutionHours).toBeNull();
  });

  it("attributes a reopened-then-re-resolved ticket as two separate resolution events", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const firstResolve = new Date(created.getTime() + 4 * HOUR_MS);
    const secondResolve = new Date(created.getTime() + 30 * HOUR_MS);
    const rows = foldTeamMetrics(
      new Set(["alice", "bob"]),
      new Map([
        ["alice", "Alice Agent"],
        ["bob", "Bob Agent"],
      ]),
      [],
      [
        { changedById: "alice", createdAt: firstResolve, ticketCreatedAt: created },
        { changedById: "bob", createdAt: secondResolve, ticketCreatedAt: created },
      ],
    );
    const alice = rows.find((r) => r.agentId === "alice")!;
    const bob = rows.find((r) => r.agentId === "bob")!;
    expect(alice.resolvedCount).toBe(1);
    expect(alice.avgResolutionHours).toBe(4);
    expect(bob.resolvedCount).toBe(1);
    expect(bob.avgResolutionHours).toBe(30);
  });

  it("includes an agent no longer in the department who had activity in the period", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const resolved = new Date(created.getTime() + 2 * HOUR_MS);
    const rows = foldTeamMetrics(
      new Set(["alice"]), // bob has since left the department
      new Map([
        ["alice", "Alice Agent"],
        ["bob", "Bob Departed"],
      ]),
      [{ ticketId: "t1", toAssigneeId: "bob" }],
      [{ changedById: "bob", createdAt: resolved, ticketCreatedAt: created }],
    );
    const bob = rows.find((r) => r.agentId === "bob")!;
    expect(bob).toBeDefined();
    expect(bob.agentName).toBe("Bob Departed");
    expect(bob.stillInDepartment).toBe(false);
    expect(bob.assignedCount).toBe(1);
    expect(bob.resolvedCount).toBe(1);
  });

  it("sorts rows by agent name", () => {
    const rows = foldTeamMetrics(
      new Set(["b", "a"]),
      new Map([
        ["b", "Zed Agent"],
        ["a", "Amy Agent"],
      ]),
      [],
      [],
    );
    expect(rows.map((r) => r.agentName)).toEqual(["Amy Agent", "Zed Agent"]);
  });
});
