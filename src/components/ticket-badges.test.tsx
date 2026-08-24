/**
 * Behaviour of the ticket status/priority/department badges.
 *
 * These carry the colour language of the queue and ticket pages, so the
 * scenarios pin the two things a reader depends on: the human-readable
 * label, and which semantic variant a value maps to. Variants are asserted
 * through the class the badge renders (`bg-success`, `bg-destructive`, ...)
 * because that is the only observable difference -- the tokens themselves
 * are guarded by src/app/theme-tokens.test.ts.
 */
import { expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { feature, scenario } from "@/test/bdd";
import { StatusBadge, PriorityBadge, DepartmentBadge } from "./ticket-badges";

feature("Ticket status badge", () => {
  scenario.each([
    { status: "RESOLVED", label: "Resolved", tint: "bg-success" },
    { status: "REOPENED", label: "Reopened", tint: "bg-destructive" },
    { status: "IN_TRIAGE", label: "In Triage", tint: "bg-warning" },
    { status: "RESOLUTION_REVIEW", label: "Resolution Review", tint: "bg-warning" },
    { status: "IN_PROGRESS", label: "In Progress", tint: "bg-primary" },
    { status: "CLOSED", label: "Closed", tint: "bg-secondary" },
  ])(
    "$status reads as '$label' in the $tint tint",
    async ({ status, label, tint }, s) => {
      await s.given(`a ticket in status ${status}`);

      const badge = await s.when("its status badge is rendered", () => {
        render(<StatusBadge status={status} />);
        return screen.getByText(label);
      });

      await s.then("the status is spelled out for a reader", () => {
        expect(badge).toBeInTheDocument();
      });

      await s.and(`it is tinted ${tint}`, () => {
        expect(badge).toHaveClass(tint);
      });
    },
  );

  scenario("An unrecognised status still renders, rather than vanishing", async (s) => {
    const badge = await s.given("a status the badge has no mapping for", () => {
      render(<StatusBadge status="SOME_FUTURE_STATE" />);
      return screen.getByText("Some Future State");
    });

    await s.then("it falls back to the default tint", () => {
      expect(badge).toHaveClass("bg-primary");
    });
  });
});

feature("Ticket priority badge", () => {
  scenario.each([
    { priority: "URGENT", tint: "bg-destructive" },
    { priority: "HIGH", tint: "bg-warning" },
    { priority: "MEDIUM", tint: "bg-primary" },
    { priority: "LOW", tint: "bg-secondary" },
  ])("$priority priority is tinted $tint", async ({ priority, tint }, s) => {
    const badge = await s.given(`a ticket at ${priority} priority`, () => {
      render(<PriorityBadge priority={priority} />);
      return screen.getByText(/priority$/);
    });

    await s.then("the label says which priority it is", () => {
      expect(badge).toHaveTextContent(
        `${priority[0]}${priority.slice(1).toLowerCase()} priority`,
      );
    });

    await s.and(`it is tinted ${tint}`, () => {
      expect(badge).toHaveClass(tint);
    });
  });
});

feature("Department badge", () => {
  scenario("A department is named without competing for attention", async (s) => {
    const badge = await s.given("a ticket routed to IT Support", () => {
      render(<DepartmentBadge name="IT Support" />);
      return screen.getByText("IT Support");
    });

    await s.then("the department name is shown", () => {
      expect(badge).toBeInTheDocument();
    });

    await s.and("it is outlined rather than filled", () => {
      expect(badge).toHaveClass("text-foreground");
      expect(badge.className).not.toMatch(
        /\bbg-(primary|secondary|success|warning|destructive)\b/,
      );
    });
  });
});
