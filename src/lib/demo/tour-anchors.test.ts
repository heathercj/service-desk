/**
 * Anchor drift guard.
 *
 * The tour addresses the UI through `data-tour` attributes. Nothing stops
 * someone deleting one while refactoring a component -- and the cost of that
 * is not a red test, it is Henry pointing at nothing in front of an audience.
 *
 * What this proves: every anchor the manifest names still exists somewhere in
 * the source. What it does NOT prove: that the anchor is reachable on the
 * route the step expects, or that it resolves to exactly one element. That is
 * e2e's job -- see the assertions threaded through
 * e2e/demo-golden-path.spec.ts, which walks the same states the tour does.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { TOUR_STEPS } from "./tour-script";

/**
 * Anchors built from a template rather than written out, e.g.
 * data-tour={`transition-${status}`}. A literal search cannot find these, so
 * the template itself is asserted instead.
 */
const TEMPLATED: Record<string, string> = {
  "transition-IN_PROGRESS": "data-tour={`transition-${status}`}",
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const SOURCE = sourceFiles("src")
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** Every anchor the manifest points at, from any of the places it can. */
function referencedAnchors(): Set<string> {
  const anchors = new Set<string>();
  for (const { step } of TOUR_STEPS) {
    if (step.anchor) anchors.add(step.anchor);
    if (step.within) anchors.add(step.within.anchor);
    const a = step.advance;
    if ("anchor" in a) anchors.add(a.anchor);
    if (a.kind === "text" && a.within) anchors.add(a.within);
  }
  return anchors;
}

feature("Tour anchors exist in the UI", () => {
  scenario("Every anchor the tour points at is present in the source", async (s) => {
    const anchors = await s.given("all anchors referenced by the manifest", () =>
      [...referencedAnchors()].sort(),
    );

    await s.then("the manifest actually references some", () =>
      expect(anchors.length).toBeGreaterThan(15),
    );

    await s.and("each one is rendered somewhere", () => {
      const missing = anchors.filter((anchor) => {
        const template = TEMPLATED[anchor];
        if (template) return !SOURCE.includes(template);
        return !SOURCE.includes(`data-tour="${anchor}"`);
      });
      expect(missing, `anchors named by the tour but not rendered anywhere`).toEqual([]);
    });
  });

  scenario("Every rendered anchor is still used by the tour", async (s) => {
    // The reverse direction: an orphaned data-tour attribute is dead weight
    // that reads as load-bearing to the next person editing the component.
    const rendered = await s.given("anchors present in the source", () => {
      const found = new Set<string>();
      for (const match of SOURCE.matchAll(/data-tour="([a-z0-9-]+)"/g)) {
        if (match[1]) found.add(match[1]);
      }
      return [...found].sort();
    });

    await s.then("none is orphaned", () => {
      const referenced = referencedAnchors();
      const orphans = rendered.filter((a) => !referenced.has(a));
      expect(orphans, "data-tour attributes no tour step uses").toEqual([]);
    });
  });
});
