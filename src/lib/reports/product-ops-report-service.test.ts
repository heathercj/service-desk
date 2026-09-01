/**
 * Pure fold logic for the Product Operating Model report, exercised in
 * isolation from the database. Covers the four signals and the
 * resolution-event sourcing that must not regress: a reopened ticket's
 * "slow to resolve" figure must come from its LATEST resolution event,
 * never the first, and never from the mutable Ticket.resolvedAt column
 * (which this fold function never even sees, by construction).
 */
import { describe, expect, it } from "vitest";
import {
  filterProductOpsRows,
  foldProductOpsRows,
  hasAnySignal,
  type ProductOpsRow,
  type TicketCandidate,
  type StatusEvent,
} from "./product-ops-report-service";
import type { Rubric } from "./rubric-settings-service";

const IMPROVEMENT_IDEAS_DEPT_ID = "dept-improvement-ideas";
const TECH_DEPT_ID = "dept-tech";

const RUBRIC: Rubric = {
  targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72, LOW: 120 },
  graceHours: 72,
};

function ticket(overrides: Partial<TicketCandidate> = {}): TicketCandidate {
  return {
    id: "t1",
    ticketNumber: "SD-000001",
    subject: "Something broke",
    departmentId: TECH_DEPT_ID,
    departmentName: "Technology Support",
    priority: "MEDIUM",
    status: "RESOLVED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    attemptedArticleIds: [],
    ...overrides,
  };
}

describe("foldProductOpsRows", () => {
  it("flags a ticket currently in the Improvement Ideas department", () => {
    const rows = foldProductOpsRows(
      [ticket({ departmentId: IMPROVEMENT_IDEAS_DEPT_ID })],
      [],
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(rows[0]!.improvementIdea).toBe(true);
  });

  it("does not flag a ticket in a different department", () => {
    const rows = foldProductOpsRows([ticket()], [], IMPROVEMENT_IDEAS_DEPT_ID, RUBRIC);
    expect(rows[0]!.improvementIdea).toBe(false);
  });

  it("flags a ticket that has ever been reopened, regardless of current status", () => {
    const events: StatusEvent[] = [
      {
        ticketId: "t1",
        toStatus: "REOPENED",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ];
    const rows = foldProductOpsRows(
      [ticket()],
      events,
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(rows[0]!.reopened).toBe(true);
  });

  it("does not flag a ticket with no reopen event", () => {
    const rows = foldProductOpsRows([ticket()], [], IMPROVEMENT_IDEAS_DEPT_ID, RUBRIC);
    expect(rows[0]!.reopened).toBe(false);
  });

  it("uses the LATEST resolution event, not the first, when a ticket was reopened and resolved twice", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const events: StatusEvent[] = [
      {
        ticketId: "t1",
        toStatus: "RESOLVED",
        createdAt: new Date(created.getTime() + 4 * 3_600_000),
      }, // 4h
      {
        ticketId: "t1",
        toStatus: "REOPENED",
        createdAt: new Date(created.getTime() + 10 * 3_600_000),
      },
      {
        ticketId: "t1",
        toStatus: "RESOLVED",
        createdAt: new Date(created.getTime() + 30 * 3_600_000),
      }, // 30h, later
    ];
    const rows = foldProductOpsRows(
      [ticket({ createdAt: created, priority: "LOW" })],
      events,
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(rows[0]!.resolutionHours).toBe(30);
    expect(rows[0]!.reopened).toBe(true);
  });

  it("marks a ticket slow to resolve only once it exceeds target + grace for its priority", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const justUnderThreshold: StatusEvent[] = [
      {
        ticketId: "t1",
        toStatus: "RESOLVED",
        createdAt: new Date(created.getTime() + 79 * 3_600_000),
      },
    ];
    const justOverThreshold: StatusEvent[] = [
      {
        ticketId: "t1",
        toStatus: "RESOLVED",
        createdAt: new Date(created.getTime() + 81 * 3_600_000),
      },
    ];
    // URGENT: target 8h + grace 72h = 80h threshold.
    const under = foldProductOpsRows(
      [ticket({ createdAt: created, priority: "URGENT" })],
      justUnderThreshold,
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    const over = foldProductOpsRows(
      [ticket({ createdAt: created, priority: "URGENT" })],
      justOverThreshold,
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(under[0]!.slowToResolve).toBe(false);
    expect(over[0]!.slowToResolve).toBe(true);
  });

  it("gives a never-resolved ticket a null resolution and slowToResolve: false, never NaN/true", () => {
    const rows = foldProductOpsRows(
      [ticket({ status: "IN_PROGRESS" })],
      [],
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(rows[0]!.resolvedAt).toBeNull();
    expect(rows[0]!.resolutionHours).toBeNull();
    expect(rows[0]!.slowToResolve).toBe(false);
  });

  it("flags a ticket where attemptedArticleIds is empty as no KB article opened", () => {
    const rows = foldProductOpsRows(
      [ticket({ attemptedArticleIds: [] })],
      [],
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(rows[0]!.noKbArticleOpened).toBe(true);
  });

  it("does not flag a ticket where the customer opened at least one suggested article", () => {
    const rows = foldProductOpsRows(
      [ticket({ attemptedArticleIds: ["article-1"] })],
      [],
      IMPROVEMENT_IDEAS_DEPT_ID,
      RUBRIC,
    );
    expect(rows[0]!.noKbArticleOpened).toBe(false);
  });
});

describe("hasAnySignal", () => {
  it("is true when at least one signal is set", () => {
    expect(
      hasAnySignal({
        ticketId: "t1",
        ticketNumber: "SD-1",
        subject: "x",
        departmentName: "d",
        priority: "MEDIUM",
        status: "QUEUED",
        createdAt: new Date(),
        resolvedAt: null,
        resolutionHours: null,
        improvementIdea: false,
        noKbArticleOpened: false,
        reopened: true,
        slowToResolve: false,
      }),
    ).toBe(true);
  });

  it("is false when no signal is set", () => {
    expect(
      hasAnySignal({
        ticketId: "t1",
        ticketNumber: "SD-1",
        subject: "x",
        departmentName: "d",
        priority: "MEDIUM",
        status: "QUEUED",
        createdAt: new Date(),
        resolvedAt: null,
        resolutionHours: null,
        improvementIdea: false,
        noKbArticleOpened: false,
        reopened: false,
        slowToResolve: false,
      }),
    ).toBe(false);
  });
});

describe("filterProductOpsRows", () => {
  function row(overrides: Partial<ProductOpsRow>): ProductOpsRow {
    return {
      ticketId: overrides.ticketId ?? "t1",
      ticketNumber: "SD-1",
      subject: "x",
      departmentName: "d",
      priority: "MEDIUM",
      status: "QUEUED",
      createdAt: new Date(),
      resolvedAt: null,
      resolutionHours: null,
      improvementIdea: false,
      noKbArticleOpened: false,
      reopened: false,
      slowToResolve: false,
      ...overrides,
    };
  }

  const rows: ProductOpsRow[] = [
    row({ ticketId: "none" }),
    row({ ticketId: "idea", improvementIdea: true }),
    row({ ticketId: "kb", noKbArticleOpened: true }),
    row({ ticketId: "reopened", reopened: true }),
    row({ ticketId: "slow", slowToResolve: true }),
  ];

  it("'all' returns only rows with at least one signal, excluding the signal-free row", () => {
    const result = filterProductOpsRows(rows, "all");
    expect(result.map((r) => r.ticketId).sort()).toEqual([
      "idea",
      "kb",
      "reopened",
      "slow",
    ]);
  });

  it("filters to exactly one signal per specific filter key", () => {
    expect(
      filterProductOpsRows(rows, "improvement-ideas").map((r) => r.ticketId),
    ).toEqual(["idea"]);
    expect(filterProductOpsRows(rows, "no-kb").map((r) => r.ticketId)).toEqual(["kb"]);
    expect(filterProductOpsRows(rows, "reopened").map((r) => r.ticketId)).toEqual([
      "reopened",
    ]);
    expect(filterProductOpsRows(rows, "slow").map((r) => r.ticketId)).toEqual(["slow"]);
  });
});
