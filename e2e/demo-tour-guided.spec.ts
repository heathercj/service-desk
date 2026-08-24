import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAsDevIdentity, DEV_IDENTITIES } from "./dev-auth";
import { TOUR_STEPS } from "../src/lib/demo/tour-script";
import { resolveDynamic, type TourContext } from "../src/lib/demo/tour-types";

/**
 * Mode 1 -- the mode the demo is actually given in. Henry narrates and a
 * human clicks.
 *
 * This is a materially different test from demo-tour-autopilot.spec.ts, and
 * the difference is the whole point. Autopilot advances the tour through each
 * step's `perform()`, which drives elements directly. A synthetic click lands
 * on a button that a presenter's real cursor cannot reach -- one covered by
 * the spotlight scrim, sitting under a sticky header, or scrolled out of
 * view. Autopilot would sail through every one of those and the room would
 * watch the tour stall.
 *
 * So this spec clicks the app itself, through the overlay, exactly where the
 * narration points. The only affordance it takes is "Fill it in for me" on
 * steps that ask for typing -- which is what a presenter does too, because
 * nobody hand-types a run token in front of an audience.
 *
 * Requires ENABLE_DEV_AUTH=true, ENABLE_DEMO_TOUR=true and `pnpm db:seed`.
 */

const TOUR_SESSION_KEY = "demo-tour.v1";

/**
 * Screenshot capture, off by default.
 *
 * Hung off this walk rather than given its own driver: the shots are only
 * worth having if they show the tour in a state it genuinely reaches, and
 * this is the walk that proves it reaches them.
 *
 *   HENRY_SHOTS=1 HENRY_SHOTS_THEME=dark pnpm exec playwright test demo-tour-guided
 */
const SHOOTING = process.env.HENRY_SHOTS === "1";
const SHOT_THEME = process.env.HENRY_SHOTS_THEME === "dark" ? "dark" : "light";
const SHOT_DIR = `docs/screenshots/${SHOT_THEME}`;

/** The states worth a picture: Henry talking, handing off, pointing, done. */
const SHOT_STEPS = new Set([
  "intake-intro",
  "intake-subject",
  "triage-handoff",
  "work-claim",
  "gate-blocked",
  "deflect-suggested",
]);

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOOTING) return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
}

/** The panel Henry speaks from. */
function panelOf(page: Page): Locator {
  return page.getByRole("complementary");
}

/**
 * Which step the engine believes it is on, read off the panel's own counter
 * rather than tracked in the spec. If the two ever disagree, the spec is
 * wrong about the app instead of quietly testing a fiction.
 */
async function currentStepIndex(page: Page): Promise<number> {
  const label = await panelOf(page)
    .getByText(/step \d+ of \d+/i)
    .innerText();
  // innerText comes back CSS-uppercased -- the counter is styled `uppercase`.
  const match = /step (\d+) of (\d+)/i.exec(label);
  if (!match) throw new Error(`Could not read the step counter from: ${label}`);
  expect(Number(match[2])).toBe(TOUR_STEPS.length);
  return Number(match[1]) - 1;
}

/**
 * The run context the engine generated, read from where the engine keeps it.
 * Needed because the row-scoping text on several steps -- the ticket number,
 * the article title -- is only knowable at run time.
 */
async function tourContext(page: Page): Promise<TourContext> {
  const raw = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    TOUR_SESSION_KEY,
  );
  if (!raw) throw new Error("The tour session is gone from sessionStorage");
  return (JSON.parse(raw) as { ctx: TourContext }).ctx;
}

/**
 * Resolves the step's anchor the way the engine does, including the row
 * narrowing. `within` scopes the step's OWN anchor and nothing else -- the
 * same rule the engine follows, and the one both previous tour stalls came
 * from breaking.
 */
function anchorLocator(
  page: Page,
  step: (typeof TOUR_STEPS)[number]["step"],
  ctx: TourContext,
): Locator {
  const target = `[data-tour="${step.anchor}"]`;
  if (!step.within) return page.locator(target);
  const containing = resolveDynamic(step.within.containing, ctx);
  return page
    .locator(`[data-tour="${step.within.anchor}"]`, { hasText: containing })
    .locator(target);
}

/**
 * Waits for the engine to leave `from`.
 *
 * Deliberately swallows read errors instead of letting them fail the poll:
 * several steps complete BY navigating, and the identity handoffs cause a
 * full page load, so reading the panel mid-flight legitimately throws for a
 * moment. Only a genuine stall -- the counter never moving -- should fail,
 * and that surfaces as the timeout.
 */
async function waitForAdvance(page: Page, from: number): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          if (await page.getByText("That is the whole loop.").isVisible()) return -1;
          return await currentStepIndex(page);
        } catch {
          return from;
        }
      },
      { timeout: 90_000, message: `The tour stalled on step ${from + 1}` },
    )
    .not.toBe(from);
}

test.describe("Guided tour, mode 1", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test("a presenter can walk the whole tour by clicking the app itself", async ({
    page,
  }) => {
    const clickedForReal: string[] = [];

    await signInAsDevIdentity(page, DEV_IDENTITIES.customer);
    await page.goto("/dashboard?tour=fast");

    if (SHOOTING && SHOT_THEME === "dark") {
      await page.getByRole("button", { name: /Switch to dark theme/ }).click();
      await expect(
        page.getByRole("button", { name: /Switch to light theme/ }),
      ).toBeVisible();
    }
    await shoot(page, "00-launcher");

    // Nothing starts on its own; the launcher is the only way in.
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const panel = panelOf(page);
    const finished = page.getByText("That is the whole loop.");

    // One iteration per action, not per step: handoffs and route recoveries
    // are actions that leave the step index where it was. The bound is a
    // stall guard -- generous enough for every real step plus its handoff,
    // tight enough that a stuck tour fails here instead of at the suite
    // timeout with nothing to read.
    for (let action = 0; action < TOUR_STEPS.length * 3; action++) {
      if (await finished.isVisible()) break;

      const index = await currentStepIndex(page);
      const entry = TOUR_STEPS[index];
      if (!entry)
        throw new Error(
          `The panel reported step ${index + 1}, which is not in the manifest`,
        );
      const { step } = entry;

      if (SHOT_STEPS.has(step.id)) {
        await shoot(page, `${String(index + 1).padStart(2, "0")}-${step.id}`);
      }

      // A handoff belongs to the step it precedes, so it is handled first and
      // does not count as progress.
      const signIn = panel.getByRole("button", { name: /^Sign in as / });
      if (await signIn.isVisible()) {
        await signIn.click();
        await expect(signIn).toBeHidden({ timeout: 60_000 });
        continue;
      }

      const back = panel.getByRole("button", { name: /^Back to / });
      if (await back.isVisible()) {
        await back.click();
        await expect(back).toBeHidden({ timeout: 60_000 });
        continue;
      }

      const advanced = waitForAdvance(page, index);

      if (step.advance.kind === "read") {
        await panel.getByRole("button", { name: "Next", exact: true }).click();
        await advanced;
        continue;
      }

      // Typing steps: take the affordance, as a presenter would.
      if (step.advance.kind === "filled" || step.advance.kind === "checked") {
        await panel.getByRole("button", { name: "Fill it in for me" }).click();
        await advanced;
        continue;
      }

      // A step with no perform has nothing for anyone to click -- the app
      // reaches the state on its own (the suggestion card arriving on the
      // debounce). Waiting IS the correct behaviour here.
      if (!step.perform) {
        await advanced;
        continue;
      }

      // Everything else: the real click, on the real control, through the
      // overlay. This is the assertion this spec exists for.
      const targetEl = anchorLocator(page, step, await tourContext(page));
      await expect(targetEl).toHaveCount(1);
      await targetEl.click({ timeout: 30_000 });
      clickedForReal.push(step.id);
      await advanced;
    }

    await expect(finished).toBeVisible({ timeout: 60_000 });
    await shoot(page, "99-finished");

    // Guards the premise: if a refactor turned these into "Do it for me"
    // presses, the walk would still pass while testing nothing it claims to.
    expect(clickedForReal).toEqual([
      "intake-submit",
      "triage-open",
      "triage-confirm",
      "work-open",
      "work-claim",
      "work-progress",
      "work-send",
      "gate-blocked",
      "kb-check",
      "kb-draft-open",
      "kb-create",
      "publish-article",
      "deflect-solved",
    ]);
  });
});
