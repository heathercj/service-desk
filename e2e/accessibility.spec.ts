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

/*
 * Dark mode gets its own focus check because that is where it broke: the
 * indicator used to be a `ring` whose 2px gap was painted in `--background`,
 * and inside a Card -- which in dark mode is two steps lighter than the page
 * -- that gap read as a dark halo blurring the ring into the card edge. Light
 * mode hid it, because `--card` and `--background` are both pure white there.
 *
 * The split with theme-tokens.test.ts is deliberate: the numbers (ring vs
 * background, ring vs card, both themes, WCAG 1.4.11's 3:1) are checked there,
 * against the tokens themselves. What only a browser can say is that the rule
 * actually reaches a focused input, and that the gap is transparent.
 */
test.describe("focus indicator in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("a keyboard-focused field draws an outline, not a surface-coloured ring", async ({
    page,
  }) => {
    await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
    await page.goto("/tickets/new");
    await expect(page.locator("html")).toHaveClass(/dark/);

    const subject = page.getByLabel(/subject/i);
    await subject.focus();
    // Focus alone does not always set :focus-visible on a mouse-driven page;
    // a keyboard interaction does, and that is the state under test.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(subject).toBeFocused();

    const style = await subject.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        outlineOffset: computed.outlineOffset,
        outlineColor: computed.outlineColor,
        boxShadow: computed.boxShadow,
      };
    });

    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
    expect(style.outlineOffset).toBe("2px");
    // The gap is the outline's own offset, so nothing paints it. A box-shadow
    // here would mean the ring utilities are back.
    expect(style.boxShadow === "none" || style.boxShadow === "").toBe(true);
    // And the line itself is drawn -- an outline colour that resolved to
    // transparent would satisfy every check above and show nothing.
    expect(style.outlineColor).not.toMatch(/transparent|rgba?\([^)]*,\s*0\)/);
  });
});
