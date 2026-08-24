"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { DEV_IDENTITIES } from "@/lib/dev-auth/dev-identities";
import { TOUR_STEPS, createTourContext } from "@/lib/demo/tour-script";
import {
  resolveDynamic,
  type Advance,
  type ResolvedScope,
  type TourStep,
} from "@/lib/demo/tour-types";
import {
  createDomDriver,
  observeUntil,
  queryAnchor,
  queryScopedRow,
} from "@/lib/demo/dom-drive";
import { Henry, HenrySays } from "./henry";
import { Spotlight } from "./spotlight";
import { loadTourSession, saveTourSession, type TourSession } from "./tour-state";

/** How long autopilot lingers on a narration-only step, by reading length. */
function dwellMs(say: string, fast: boolean): number {
  return fast ? 250 : Math.min(15_000, 3_000 + say.length * 45);
}

function identityFor(key: string) {
  return DEV_IDENTITIES.find((i) => i.key === key);
}

function valueOf(el: HTMLElement | null): string | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return null;
}

/**
 * Henry: the guided tour of the golden path.
 *
 * Nothing starts on its own. Free exploration is the default state of the
 * app, and the launcher is the only way in -- so a visitor who just wants to
 * click around never has a tour imposed on them, and Exit hands control back
 * immediately.
 *
 * Mounted from the root layout behind ENABLE_DEMO_TOUR (see src/lib/env.ts,
 * which also refuses to boot with it set in production).
 */
export function DemoGuide({ signedInAs }: { signedInAs: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<TourSession | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [wandered, setWandered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-step latches. Refs, not state: they gate side effects and must not
  // themselves cause a re-render, or the effects they gate re-run forever.
  const navigatedFor = useRef<string | null>(null);
  const performedFor = useRef<string | null>(null);
  /**
   * The step whose perform() is still running.
   *
   * An advance condition is meant to prove the APP did something. While the
   * tour is still driving the field, it proves nothing: `filled` is satisfied
   * by the first character, so without this the panel moves to the next cue
   * roughly three seconds before the typing it started has finished. A
   * presenter who follows the cue promptly then submits a half-typed form --
   * which is how mode 1 stalled on intake-submit, with the app rejecting a
   * description below the 30-character minimum.
   */
  const performing = useRef<string | null>(null);
  const handedOffFor = useRef<string | null>(null);
  const wasFilled = useRef<string | null>(null);

  // ?tour=fast strips the pauses. Read once, at start, and then carried in
  // the session -- the tour navigates away from the query string almost
  // immediately, so re-reading it later would silently revert to slow.
  const [fastRequested, setFastRequested] = useState(false);
  const fast = session?.fast ?? fastRequested;

  const driver = useMemo(
    () => createDomDriver(fast ? { typeDelayMs: 0, clickDelayMs: 0 } : {}),
    [fast],
  );

  // sessionStorage is read after mount, never during render: reading it in a
  // useState initialiser would make the server and client markup disagree.
  useEffect(() => {
    const loaded = loadTourSession();
    setSession(loaded && loaded.stepIndex <= TOUR_STEPS.length ? loaded : null);
    setFastRequested(new URLSearchParams(window.location.search).get("tour") === "fast");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveTourSession(session);
  }, [hydrated, session]);

  const entry = session ? TOUR_STEPS[session.stepIndex] : undefined;
  const step: TourStep | undefined = entry?.step;
  const ctx = session?.ctx;

  const route = step && ctx ? resolveDynamic(step.route, ctx) : null;
  // Memoised because the advance predicate depends on it: a fresh object
  // every render would re-arm the observer on every render.
  const scope = useMemo<ResolvedScope | undefined>(
    () =>
      step?.within && ctx
        ? {
            anchor: step.within.anchor,
            containing: resolveDynamic(step.within.containing, ctx),
          }
        : undefined,
    [step, ctx],
  );

  const expected = step ? identityFor(step.as) : undefined;
  const identityOk = Boolean(expected && signedInAs === expected.displayName);
  const routeOk = route !== null && pathname === route;

  const advance = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const current = TOUR_STEPS[prev.stepIndex];
      if (!current) return prev;
      const captured =
        current.step.capture?.({ pathname: window.location.pathname }) ?? {};
      return {
        ...prev,
        stepIndex: prev.stepIndex + 1,
        ctx: { ...prev.ctx, ...captured },
      };
    });
    setWandered(false);
    setError(null);
  }, []);

  /**
   * The one place a perform() is started. Autopilot and the mode-1 button both
   * come through here so the in-flight guard cannot be bypassed by one of
   * them.
   */
  const runPerform = useCallback(async () => {
    if (!step?.perform || !ctx) return;
    performedFor.current = step.id;
    performing.current = step.id;
    try {
      await step.perform(ctx, driver);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not do that");
    } finally {
      // Guarded: a step exited early (an exit, a restart) must not clear a
      // perform belonging to whatever is running now.
      if (performing.current === step.id) performing.current = null;
    }
  }, [step, ctx, driver]);

  const start = useCallback(
    (autopilot: boolean) => {
      navigatedFor.current = null;
      performedFor.current = null;
      performing.current = null;
      handedOffFor.current = null;
      wasFilled.current = null;
      setError(null);
      setWandered(false);
      setSession({
        stepIndex: 0,
        autopilot,
        fast: fastRequested,
        ctx: createTourContext(),
      });
    },
    [fastRequested],
  );

  const exit = useCallback(() => {
    setSession(null);
    saveTourSession(null);
    setDismissed(true);
  }, []);

  const handoff = useCallback(() => {
    if (!step || !route) return;
    if (handedOffFor.current === step.id) return;
    handedOffFor.current = step.id;
    // A full navigation rather than a client-side session refresh: the tour's
    // place lives in sessionStorage precisely so it can survive this.
    void signIn("dev-credentials", { devUserKey: step.as, callbackUrl: route });
  }, [step, route]);

  /**
   * Whether the current step's completion condition holds right now.
   *
   * `within` narrows THE ELEMENT THE STEP POINTS AT -- the publish button in
   * this article's row, the link for this ticket. It must not be applied to an
   * advance that watches something else: the deflection step points at a
   * button inside a suggestion row, but waits for a confirmation card that
   * REPLACES that row. Scoping that wait to the row means waiting inside an
   * element that no longer exists, which is precisely how the tour stalled on
   * its last beat.
   */
  const satisfied = useCallback(
    (a: Advance): boolean => {
      // Only the step's own anchor inherits the row narrowing.
      const scopeFor = (anchor: string) => (anchor === step?.anchor ? scope : undefined);

      switch (a.kind) {
        case "read":
          return false; // narration only -- the human continues
        case "appears":
          return queryAnchor(a.anchor, scopeFor(a.anchor)) !== null;
        case "filled":
          return (valueOf(queryAnchor(a.anchor, scopeFor(a.anchor))) ?? "").trim() !== "";
        case "emptied": {
          const value = valueOf(queryAnchor(a.anchor, scopeFor(a.anchor)));
          if (value === null) return false;
          // Only counts as emptied if we watched it hold text first --
          // otherwise the step would satisfy itself the instant it began.
          if (value !== "") {
            wasFilled.current = step?.id ?? null;
            return false;
          }
          return wasFilled.current === step?.id;
        }
        case "checked": {
          const el = queryAnchor(a.anchor, scopeFor(a.anchor));
          return el instanceof HTMLInputElement && el.checked;
        }
        case "text": {
          // `within` may name the very row the step is scoped to -- the
          // article row carrying THIS title, not whichever row happens to be
          // first in the document. Without that narrowing, a manage console
          // holding twenty other drafts never satisfies this condition, which
          // is exactly how the publish beat stalled.
          const root =
            a.within === undefined
              ? document.body
              : scope?.anchor === a.within
                ? queryScopedRow(scope)
                : queryAnchor(a.within, scopeFor(a.within));
          return root !== null && a.pattern.test((root.textContent ?? "").trim());
        }
        case "route":
          return a.pattern.test(pathname);
      }
    },
    [scope, pathname, step?.id, step?.anchor],
  );

  // --- Advance detection. Runs before route enforcement below, so a step
  // whose completion IS a navigation is never mistaken for wandering off.
  useEffect(() => {
    if (!step || !identityOk) return;
    const a = step.advance;

    if (a.kind === "read") return;

    if (a.kind === "route") {
      if (a.pattern.test(pathname)) advance();
      return;
    }

    // performing.current is read fresh on every poll, so the guard lifts on
    // its own when the perform resolves -- no re-render needed to release it.
    return observeUntil(() => performing.current === null && satisfied(a), advance);
  }, [step, identityOk, pathname, satisfied, advance]);

  // --- Get us to the right identity and the right page.
  useEffect(() => {
    if (!step || !route) return;
    if (!identityOk) return; // the handoff card takes over
    if (routeOk) {
      setWandered(false);
      return;
    }
    if (step.advance.kind === "route" && step.advance.pattern.test(pathname)) return;

    if (navigatedFor.current === step.id) {
      // We already brought them here once and they left again. Offer the way
      // back rather than yanking them; a technical audience clicking around
      // mid-demo is the expected behaviour, not a fault.
      setWandered(true);
      return;
    }
    navigatedFor.current = step.id;
    router.push(route);
  }, [step, route, routeOk, identityOk, pathname, router]);

  // --- Autopilot.
  useEffect(() => {
    if (!session?.autopilot || !step || !ctx) return;
    if (!identityOk) {
      handoff();
      return;
    }
    if (!routeOk || wandered) return;

    if (step.advance.kind === "read") {
      const timer = setTimeout(advance, dwellMs(resolveDynamic(step.say, ctx), fast));
      return () => clearTimeout(timer);
    }
    if (!step.perform || performedFor.current === step.id) return;
    void runPerform();
  }, [
    session?.autopilot,
    step,
    ctx,
    identityOk,
    routeOk,
    wandered,
    advance,
    handoff,
    runPerform,
    fast,
  ]);

  if (!hydrated) return null;

  // --- Launcher. The app's default state: no tour, no overlay, no scrim.
  if (!session) {
    if (dismissed) return null;
    return (
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-2.5 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
        <Henry className="h-12 w-12" />
        <HenrySays>
          <p className="text-sm font-medium leading-tight">
            Henry can walk you through it
          </p>
          <p className="text-xs text-muted-foreground">
            Intake to reuse, on real records.
          </p>
        </HenrySays>
        <div className="flex shrink-0 flex-col gap-1">
          <Button size="sm" onClick={() => start(false)}>
            Start
          </Button>
          <Button size="sm" variant="outline" onClick={() => start(true)}>
            Autopilot
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss the tour offer"
          className="self-start text-muted-foreground hover:text-foreground"
        >
          &times;
        </button>
      </div>
    );
  }

  const total = TOUR_STEPS.length;

  // --- Finished.
  if (!entry || !step || !ctx) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
        <Henry className="h-12 w-12" />
        <div className="min-w-0 flex-1 space-y-2">
          <HenrySays>
            <p className="text-sm font-medium">That is the whole loop.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              One ticket in, one article out, and the second report of the same problem
              cost the desk nothing. Everything you just saw is real data -- the article
              is a file on disk under knowledge-base/.
            </p>
          </HenrySays>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => start(false)}>
              Again
            </Button>
            <Button size="sm" onClick={exit}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const say = resolveDynamic(step.say, ctx);
  const cue = step.cue ? resolveDynamic(step.cue, ctx) : null;
  const performLabel =
    step.advance.kind === "filled" || step.advance.kind === "checked"
      ? "Fill it in for me"
      : "Do it for me";

  return (
    <>
      {identityOk && routeOk && !wandered && (
        <Spotlight anchor={step.anchor} scope={scope} />
      )}

      <aside
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {entry.beat.title} &middot; step {session.stepIndex + 1} of {total}
            </p>
            <p className="text-xs text-muted-foreground">{entry.beat.premise}</p>
          </div>
          <button
            type="button"
            onClick={exit}
            aria-label="Exit the tour"
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        {/* Henry and what he is saying. All three states speak through the one
            bubble -- a handoff and a wander are Henry talking too, and giving
            them their own treatment made the panel jump around mid-demo. */}
        <div className="mt-3 flex items-start gap-2.5">
          <Henry className="mt-0.5 h-14 w-14" />
          <HenrySays>
            {!identityOk && expected ? (
              <p className="text-sm">
                <span className="font-medium">Hand-off.</span> This beat belongs to{" "}
                {expected.displayName} ({expected.roles.join(", ").toLowerCase()}).{" "}
                {expected.description}
              </p>
            ) : wandered ? (
              <p className="text-sm">
                You have wandered off the path -- which is fine, have a look around. When
                you are ready I will put us back.
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed">{say}</p>
                {cue && <p className="mt-2 text-sm font-medium text-warning">{cue}</p>}
              </>
            )}
          </HenrySays>
        </div>

        <div className="mt-3 space-y-3">
          {!identityOk && expected ? (
            <Button size="sm" onClick={handoff}>
              Sign in as {expected.displayName}
            </Button>
          ) : wandered ? (
            <Button
              size="sm"
              onClick={() => {
                navigatedFor.current = null;
                setWandered(false);
                if (route) router.push(route);
              }}
            >
              Back to {entry.beat.title}
            </Button>
          ) : (
            <>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {step.advance.kind === "read" && (
                  <Button size="sm" onClick={advance}>
                    Next
                  </Button>
                )}
                {step.perform && step.advance.kind !== "read" && (
                  <Button size="sm" variant="outline" onClick={() => void runPerform()}>
                    {performLabel}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSession((prev) =>
                      prev ? { ...prev, autopilot: !prev.autopilot } : prev,
                    )
                  }
                >
                  {session.autopilot ? "Take the wheel" : "Autopilot"}
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
