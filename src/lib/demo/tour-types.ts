/**
 * Types for the guided demo tour ("Henry the Lion").
 *
 * The tour narrates the same five beats the golden-path e2e spec walks
 * (e2e/demo-golden-path.spec.ts). There is exactly ONE manifest -- see
 * tour-script.ts -- and both modes consume it:
 *
 *   Mode 1  Henry narrates, a human clicks. Steps that fill in text still
 *           offer "fill it in for me", because nobody should have to type a
 *           run token by hand in front of an audience.
 *   Mode 2  Autopilot. Henry performs every step that has a `perform`.
 *
 * Steps address the UI through `data-tour` attributes rather than text or
 * ARIA roles, so renaming a button breaks e2e/demo-tour-anchors.spec.ts
 * instead of breaking the demo live.
 */

/** The five seeded identities the tour signs in as. Asserted against
 *  src/lib/dev-auth/dev-identities.ts by tour-script.test.ts. */
export type DevIdentityKey =
  | "customer"
  | "customer2"
  | "triage"
  | "dept-agent"
  | "knowledge-manager";

/**
 * Values threaded through the run. `run` is a rare token planted in the
 * subject -- and therefore in the article title drafted from it -- so the
 * final beat's suggestion lookup finds THIS article and not seed data. Same
 * trick, and the same reason, as the e2e spec.
 */
export interface TourContext {
  run: string;
  subject: string;
  similarSubject: string;
  description: string;
  reply: string;
  resolutionSummary: string;
  resolutionSteps: string;
  articleSummary: string;
  articleBody: string;
  /** Captured from the URL in beat 1; every later beat needs it. */
  ticketNumber?: string;
}

/** A value that may depend on what earlier steps produced. */
export type Dynamic<T> = T | ((ctx: TourContext) => T);

/**
 * Note the narrow use: every Dynamic in the manifest resolves to a string,
 * so treating a function value as the producer is safe here. It would not be
 * if we ever wanted a Dynamic<() => void>.
 */
export function resolveDynamic<T>(value: Dynamic<T>, ctx: TourContext): T {
  return typeof value === "function" ? (value as (c: TourContext) => T)(ctx) : value;
}

/**
 * How the tour knows a step is finished.
 *
 * `emptied` exists because of a bug the e2e spec hit and documents at
 * demo-golden-path.spec.ts:139-142: asserting the reply text is visible
 * passes on the copy still sitting in the textarea, while the POST is
 * silently cancelled. The box clearing is what proves the write landed. A
 * demo must not be able to make that mistake in front of an audience, so
 * "the user pressed Next" is never an acceptable advance for a step with a
 * side effect.
 */
export type Advance =
  /** Narration only -- nothing happened, the human reads and continues. */
  | { kind: "read" }
  | { kind: "click"; anchor: string }
  | { kind: "appears"; anchor: string }
  | { kind: "filled"; anchor: string }
  | { kind: "emptied"; anchor: string }
  | { kind: "checked"; anchor: string }
  | { kind: "text"; pattern: RegExp; within?: string }
  | { kind: "route"; pattern: RegExp };

/**
 * Narrows an anchor to the one inside a repeated row -- the right ticket in a
 * queue, the right article in the management console. Without this, "click
 * Publish" is ambiguous the moment a second draft exists, which on a demo
 * machine is always.
 */
export interface AnchorScope {
  /** The repeated container, e.g. "article-row". */
  anchor: string;
  /** Text that identifies the one we want, e.g. the ticket number. */
  containing: Dynamic<string>;
}

export interface DomDriver {
  /** Types character by character: it looks alive, and it exercises the
   *  suggestion debounce the way a human does -- which the final beat needs. */
  type(anchor: string, text: string, scope?: ResolvedScope): Promise<void>;
  click(anchor: string, scope?: ResolvedScope): Promise<void>;
  check(anchor: string, scope?: ResolvedScope): Promise<void>;
}

/** A scope with its `containing` text already resolved against the context. */
export interface ResolvedScope {
  anchor: string;
  containing: string;
}

export interface TourStep {
  /** Stable; referenced by the anchor test and by resume-after-reload. */
  id: string;
  /** Who must be signed in. A change from the previous step is a handoff. */
  as: DevIdentityKey;
  route: Dynamic<string>;
  /** Henry's narration. Names the enforcement point, not the benefit. */
  say: Dynamic<string>;
  /** The imperative, if the human has something to do. */
  cue?: Dynamic<string>;
  /** What to spotlight. */
  anchor?: string;
  within?: AnchorScope;
  advance: Advance;
  /** Autopilot, and the "fill it in for me" affordance in mode 1. */
  perform?: (ctx: TourContext, dom: DomDriver) => Promise<void>;
  capture?: (loc: { pathname: string }) => Partial<TourContext>;
}

export interface TourBeat {
  id: string;
  title: string;
  /** One line on what this beat proves -- shown on the chapter card. */
  premise: string;
  steps: TourStep[];
}
