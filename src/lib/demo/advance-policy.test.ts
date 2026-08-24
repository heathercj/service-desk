/**
 * Who decides a step is over.
 *
 * Autopilot and mode 1 answer that differently, and the difference is the
 * whole point: autopilot moves itself, while a presenter's tour must not move
 * under them mid-sentence. What both share is the rule from tour-types.ts --
 * a step with a side effect is never over until the app confirms the effect
 * landed. Mode 1 adds a press on top of that; it does not replace it.
 */
import { expect } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { onConditionMet, nextIsAvailable } from "./advance-policy";

feature("Guided tour advance policy", () => {
  scenario("Autopilot moves itself the moment the condition is met", async (s) => {
    await s.then("a met condition advances outright", () =>
      expect(onConditionMet({ autopilot: true })).toBe("advance"),
    );
  });

  scenario("A presenter's tour arms Next instead of moving", async (s) => {
    // The bug this fixes: `filled` is satisfied by a single character, so
    // typing "E" into the subject threw the card away while the presenter was
    // still talking about it.
    await s.then("a met condition only arms the control", () =>
      expect(onConditionMet({ autopilot: false })).toBe("arm"),
    );
  });

  scenario("Narration is always the presenter's to end", async (s) => {
    await s.then("Next is available with nothing to wait for", () =>
      expect(nextIsAvailable("read", false)).toBe(true),
    );
  });

  scenario("A step with a side effect cannot be pressed past", async (s) => {
    // Not merely unhelpful -- this is the failure tour-types.ts documents: the
    // reply that looks sent while the POST was silently cancelled. Pressing
    // Next through it would put that failure back, in front of a room.
    await s.then("Next is unavailable until the effect lands", () => {
      expect(nextIsAvailable("emptied", false)).toBe(false);
      expect(nextIsAvailable("filled", false)).toBe(false);
      expect(nextIsAvailable("route", false)).toBe(false);
    });
    await s.and("and available once it has", () =>
      expect(nextIsAvailable("emptied", true)).toBe(true),
    );
  });
});
