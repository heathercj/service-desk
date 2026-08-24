/**
 * Behaviour of the authorisation refusal shown by server components when a
 * policy check fails. It has to be announced, not just styled: a reader who
 * navigated to a page they cannot see needs to be told why.
 */
import { expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { feature, scenario } from "@/test/bdd";
import { AccessDenied } from "./access-denied";

feature("Access denied notice", () => {
  scenario("A user reaches a page their roles do not allow", async (s) => {
    await s.given("a customer opened a triage-only page");

    const alert = await s.when("the page renders its refusal", () => {
      render(<AccessDenied />);
      return screen.getByRole("alert");
    });

    await s.then("the refusal is announced, not merely displayed", () => {
      expect(alert).toBeInTheDocument();
    });

    await s.and("it is headed 'Access denied'", () => {
      expect(screen.getByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    });

    await s.and("a generic explanation stands in", () => {
      expect(alert).toHaveTextContent("You don't have permission to view this.");
    });
  });

  scenario("A caller explains the specific reason", async (s) => {
    const alert = await s.given("a page that knows why access was refused", () => {
      render(<AccessDenied message="This ticket belongs to another department." />);
      return screen.getByRole("alert");
    });

    await s.then("that reason replaces the generic one", () => {
      expect(alert).toHaveTextContent("This ticket belongs to another department.");
      expect(alert).not.toHaveTextContent("You don't have permission to view this.");
    });
  });
});
