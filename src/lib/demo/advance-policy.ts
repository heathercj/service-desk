import type { Advance } from "./tour-types";

/**
 * When a step's advance condition is met, who moves the tour on.
 *
 * Autopilot moves itself -- that is what it is. Mode 1 does not: the
 * condition being met makes the step *finishable*, and the presenter decides
 * when. Advancing on the condition alone threw the card away mid-sentence,
 * because most conditions are met far earlier than they read: `filled` is
 * true after one character, `checked` the instant the box is ticked, and
 * `appears` often on arrival.
 */
export function onConditionMet({ autopilot }: { autopilot: boolean }): "advance" | "arm" {
  return autopilot ? "advance" : "arm";
}

/**
 * Whether Next can be pressed now, in mode 1.
 *
 * Narration is always the presenter's to end -- nothing happened, so there is
 * nothing to confirm. Every other step must wait for `armed`, which only the
 * app's own state can set. That preserves the rule tour-types.ts explains at
 * length: a step with a side effect is over when the effect lands, never
 * because somebody pressed a button. Mode 1 asks for a press *in addition*,
 * so nothing moves unbidden -- it does not offer a way past a step whose
 * write silently failed.
 */
export function nextIsAvailable(kind: Advance["kind"], armed: boolean): boolean {
  return kind === "read" ? true : armed;
}
