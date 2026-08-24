/**
 * Where the tour keeps its place.
 *
 * sessionStorage rather than React state, because the tour survives two
 * things that wipe React state entirely: ordinary navigation between routes,
 * and the full page load that a dev-auth identity handoff causes. It is
 * per-tab and disappears when the tab does, which is exactly the lifetime a
 * demo wants.
 */
import type { TourContext } from "@/lib/demo/tour-types";

const KEY = "demo-tour.v1";

export interface TourSession {
  stepIndex: number;
  /** Henry drives instead of the human. */
  autopilot: boolean;
  /**
   * Skips the deliberate typing and reading pauses. For rehearsing the tour
   * and for the e2e run that proves it still completes -- not for a live
   * audience, who need the pauses to follow along.
   */
  fast: boolean;
  ctx: TourContext;
}

export function loadTourSession(): TourSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TourSession;
    // A manifest edit between reloads can leave a stale index behind; the
    // caller clamps it. Anything structurally wrong is discarded outright
    // rather than crashing the page it is drawn on.
    if (typeof parsed?.stepIndex !== "number" || !parsed.ctx) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTourSession(session: TourSession | null): void {
  try {
    if (session === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // A tour that cannot persist is still worth running; it just will not
    // survive the next identity handoff. Better than a thrown error on a
    // page the audience is looking at.
  }
}
