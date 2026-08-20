import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";

/**
 * Section 17: "Include accessibility checks for critical pages where
 * practical." Runs axe-core against the pages every role touches first.
 */
test("login page has no critical accessibility violations", async ({ page }) => {
  await page.goto("/login");
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
