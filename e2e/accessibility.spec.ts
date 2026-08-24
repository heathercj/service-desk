import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Section 17: "Include accessibility checks for critical pages where
 * practical." Runs axe-core against the pages every role touches first.
 */
test("login page has no critical accessibility violations", async ({ page }) => {
  await page.goto("/login");
  // Wait for Henry's launcher before scanning, rather than scanning whatever
  // has rendered by now. It mounts from a client effect, so axe used to race
  // it: the same contrast violation in his bubble was reported on some
  // full-suite runs and not on isolated ones, which read as flake and was a
  // real 4.27:1 failure the scan was only sometimes looking at. The suite
  // already requires ENABLE_DEMO_TOUR=true, so this is not conditional.
  await page.getByText("Hey, I'm Henry the Lion!").waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === "critical" || v.impact === "serious"),
  ).toEqual([]);
});

test("customer dashboard has no critical accessibility violations", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
  await page.goto("/dashboard");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === "critical" || v.impact === "serious"),
  ).toEqual([]);
});

test("new ticket form has no critical accessibility violations", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
  await page.goto("/tickets/new");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === "critical" || v.impact === "serious"),
  ).toEqual([]);
});

test("triage queue has no critical accessibility violations", async ({ page }) => {
  await signInAsDevIdentity(page, DEV_IDENTITIES.triage);
  await page.goto("/triage");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === "critical" || v.impact === "serious"),
  ).toEqual([]);
});
