/**
 * Integrity of the tour manifest.
 *
 * These are cheap invariants that would otherwise fail live, in front of an
 * audience, on the one step nobody rehearsed. Whether the anchors actually
 * exist in the UI is a different question, answered by
 * e2e/demo-tour-anchors.spec.ts -- this file only checks the manifest is
 * internally coherent.
 */
import { expect } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { DEV_IDENTITIES } from "@/lib/dev-auth/dev-identities";
import { TOUR, TOUR_STEPS, createTourContext } from "./tour-script";
import { resolveDynamic } from "./tour-types";

const ctx = { ...createTourContext(1_700_000_000_000), ticketNumber: "SD-1234" };

feature("Guided tour manifest", () => {
  scenario("Every step has a unique id", async (s) => {
    const ids = await s.given("all step ids in order", () =>
      TOUR_STEPS.map(({ step }) => step.id),
    );
    await s.then("no id is repeated", () => expect(new Set(ids).size).toBe(ids.length));
  });

  scenario("Every identity the tour signs in as is really seeded", async (s) => {
    // Guards the one failure that cannot be recovered from mid-demo: dev-auth
    // rejects an unknown key outright, so a typo here strands the tour with
    // nobody signed in.
    const seeded = await s.given(
      "the seeded dev identity keys",
      () => new Set(DEV_IDENTITIES.map((i) => i.key)),
    );
    await s.then("each step's identity exists", () => {
      for (const { step } of TOUR_STEPS) {
        expect(seeded, `step "${step.id}" signs in as an unseeded identity`).toContain(
          step.as,
        );
      }
    });
  });

  scenario("No step needs the ticket number before it has been captured", async (s) => {
    const capturedAt = await s.given("the index of the capturing step", () =>
      TOUR_STEPS.findIndex(({ step }) => step.capture !== undefined),
    );
    await s.then("something captures it at all", () =>
      expect(capturedAt).toBeGreaterThanOrEqual(0),
    );
    await s.and("no earlier step resolves a route that needs it", () => {
      // Resolving against a context with ticketNumber deliberately absent:
      // any step that interpolates it would produce "undefined" in the path.
      const blank = { ...createTourContext(1), ticketNumber: undefined };
      TOUR_STEPS.slice(0, capturedAt + 1).forEach(({ step }) => {
        expect(
          resolveDynamic(step.route, blank),
          `step "${step.id}" needs the ticket number too early`,
        ).not.toContain("undefined");
      });
    });
  });

  scenario("Every route is an app-relative path", async (s) => {
    await s.then("each resolves to something starting with /", () => {
      for (const { step } of TOUR_STEPS) {
        expect(resolveDynamic(step.route, ctx), `step "${step.id}"`).toMatch(/^\//);
      }
    });
  });

  scenario("Every step that asks for an action names what to click", async (s) => {
    // A cue with no anchor is a step that tells the audience to do something
    // and then fails to show them where.
    await s.then("a cue always comes with an anchor", () => {
      for (const { step } of TOUR_STEPS) {
        if (step.cue === undefined) continue;
        expect(step.anchor, `step "${step.id}" has a cue but no anchor`).toBeDefined();
      }
    });
  });

  scenario("Nothing with a side effect advances on the human's word", async (s) => {
    // The demo must be driven by what the app actually did. A step that has a
    // perform() changes server state, so "read" is never a valid advance for
    // it -- that is how you end up narrating a write that silently failed.
    await s.then("every performing step waits on an observed change", () => {
      for (const { step } of TOUR_STEPS) {
        if (!step.perform) continue;
        expect(step.advance.kind, `step "${step.id}"`).not.toBe("read");
      }
    });
  });

  scenario("Scoped anchors resolve their identifying text", async (s) => {
    // An empty `containing` would match the first row on the page, which on a
    // demo machine is somebody else's ticket.
    await s.then("each within-scope resolves to non-empty text", () => {
      for (const { step } of TOUR_STEPS) {
        if (!step.within) continue;
        expect(
          resolveDynamic(step.within.containing, ctx).trim(),
          `step "${step.id}" scopes to empty text`,
        ).not.toBe("");
      }
    });
  });

  scenario("The run token threads through every value that must match", async (s) => {
    const fresh = await s.given("a fresh context", () => createTourContext(42));

    await s.then("it is in both descriptions, so demo:clean can sweep them", () => {
      expect(fresh.description).toContain(fresh.run);
      expect(fresh.similarDescription).toContain(fresh.run);
    });

    // The publish beat scopes its row by article title. Without a unique one
    // it picks the first matching row in a console full of old drafts and
    // then waits forever for someone else's article to say PUBLISHED.
    await s.and("it is in the article title, so the publish beat finds its row", () =>
      expect(fresh.articleTitle).toContain(fresh.run),
    );

    // The subject is the line the room reads. A token in it undoes the point
    // of a realistic scenario, so this asserts its absence deliberately.
    await s.and("it is NOT in either subject, which the audience reads", () => {
      expect(fresh.subject).not.toContain(fresh.run);
      expect(fresh.similarSubject).not.toContain(fresh.run);
    });

    await s.and("Jordan does not reuse Casey's words", () =>
      expect(fresh.similarDescription).not.toBe(fresh.description),
    );

    await s.and("two runs never collide", () =>
      expect(createTourContext(42).run).not.toBe(createTourContext(43).run),
    );
  });

  scenario("The visibility card explains internal-only without ticking it", async (s) => {
    // Narration only, deliberately. Internal-only articles are never offered
    // as deflection suggestions, so a step that actually ticked the box would
    // leave the payoff beat pointing at an empty suggestion panel -- the one
    // failure this whole tour exists to demonstrate the opposite of.
    const found = await s.given("the visibility step and the create step", () => ({
      visibility: TOUR_STEPS.findIndex(({ step }) => step.id === "kb-visibility"),
      create: TOUR_STEPS.findIndex(({ step }) => step.id === "kb-create"),
    }));
    await s.then("the tour explains the choice at all", () =>
      expect(found.visibility).toBeGreaterThanOrEqual(0),
    );
    await s.and("it is explained before the draft is created", () =>
      expect(found.visibility).toBeLessThan(found.create),
    );
    await s.and("it never ticks the box", () => {
      const entry = TOUR_STEPS[found.visibility];
      expect(entry).toBeDefined();
      expect(
        entry?.step.perform,
        "kb-visibility must not tick internal-only",
      ).toBeUndefined();
      expect(entry?.step.advance.kind).toBe("read");
    });
  });

  scenario("The tour admits a ticket can land in the wrong place", async (s) => {
    // Narration only. The demo's ticket is correctly routed, so a step that
    // actually transferred it would send the whole rest of the tour to another
    // department's queue -- but a room full of people who route tickets for a
    // living will ask, and the honest answer is that mistakes are recoverable.
    const found = await s.given("the misroute step and the step that claims it", () => ({
      misroute: TOUR_STEPS.findIndex(({ step }) => step.id === "work-misroute"),
      claim: TOUR_STEPS.findIndex(({ step }) => step.id === "work-claim"),
    }));

    await s.then("the tour mentions it at all", () =>
      expect(found.misroute).toBeGreaterThanOrEqual(0),
    );

    await s.and("it comes up once somebody owns the ticket", () =>
      expect(found.misroute).toBeGreaterThan(found.claim),
    );

    await s.and("it says so in words rather than moving the ticket", () => {
      const entry = TOUR_STEPS[found.misroute];
      expect(entry).toBeDefined();
      expect(
        entry?.step.perform,
        "work-misroute must not actually transfer the ticket",
      ).toBeUndefined();
      expect(entry?.step.advance.kind).toBe("read");
    });

    await s.and("it names both directions a mis-routed ticket can move", () => {
      const said = TOUR_STEPS[found.misroute]?.step.say ?? "";
      expect(said).toMatch(/department/i);
      expect(said).toMatch(/colleague|agent|teammate/i);
    });
  });

  scenario("Each beat carries a premise and at least one step", async (s) => {
    await s.then("no beat is empty or unexplained", () => {
      for (const beat of TOUR) {
        expect(beat.steps.length, `beat "${beat.id}"`).toBeGreaterThan(0);
        expect(beat.premise.trim(), `beat "${beat.id}"`).not.toBe("");
      }
    });
  });
});
