/**
 * Stateful stand-in for `@/lib/auth/session`, so route tests can choose who
 * is calling without standing up NextAuth or a database.
 *
 * Route handlers reach the session through `requireAuthContext()` rather
 * than taking the actor as an argument, so the seam has to be the module
 * itself. Test files opt in with:
 *
 *   vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
 *
 * then set the caller per scenario via `setCurrentActor(actors.customer())`.
 * `signOut()` makes the next call behave as an unauthenticated request,
 * which is how the 401 scenarios are written.
 */
import type { AuthContext } from "@/lib/auth/session";

let currentActor: AuthContext | null = null;

export function setCurrentActor(actor: AuthContext | null): void {
  currentActor = actor;
}

/** Equivalent to an anonymous request -- `requireAuthContext` will throw. */
export function signOut(): void {
  currentActor = null;
}

export function getCurrentActor(): AuthContext | null {
  return currentActor;
}

// --- the mocked module surface, matching src/lib/auth/session.ts ---

export async function getAuthContext(): Promise<AuthContext | null> {
  return currentActor;
}

export async function requireAuthContext(): Promise<AuthContext> {
  if (!currentActor) {
    // Same sentinel the real module throws; route-helpers maps it to 401.
    throw new Error("UNAUTHENTICATED");
  }
  return currentActor;
}
