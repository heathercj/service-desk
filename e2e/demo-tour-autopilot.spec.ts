import { test, expect } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Proves the tour ENGINE still works, as opposed to the app it narrates.
 *
 * The golden-path spec walks the flow with Playwright driving. This one hands
 * the wheel to Henry and only checks he arrives: every identity handoff, every
 * route push, every perform(), and every advance condition has to fire in
 * order for the completion card to appear. If any single step's anchor or
 * completion condition is wrong, the tour stalls there and this fails.
 *
 * Runs with ?tour=fast, which strips the deliberate typing and reading
 * pauses -- a live audience needs those, a test does not.
 *
 * Requires ENABLE_DEV_AUTH=true, ENABLE_DEMO_TOUR=true and `pnpm db:seed`.
 */
test.describe("Guided tour autopilot", () => {
  // Twenty-six steps, five sign-ins, and a dev-mode compile on first hit of
  // each route. Nothing like the default 30s.
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  test("Henry walks the whole golden path unattended", async ({ page }) => {
    await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
    await page.goto("/dashboard?tour=fast");

    // Nothing starts on its own: the launcher is the only way in.
    const launcher = page.getByRole("button", { name: "Autopilot", exact: true });
    await expect(launcher).toBeVisible();
    await launcher.click();

    // Arriving here means all twenty-six steps advanced on observed state --
    // no step was skipped, because a stalled step never advances.
    await expect(page.getByText("That is the whole loop.")).toBeVisible({
      timeout: 280_000,
    });
  });
});
