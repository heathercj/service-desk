import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireAuthContext, type AuthContext } from "@/lib/auth/session";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { InvalidTransitionError } from "@/lib/tickets/state-machine";
import { checkRateLimit } from "@/lib/http/rate-limit";

export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super("Too many requests");
    this.name = "RateLimitedError";
  }
}

/**
 * Shared error -> HTTP status mapping for API route handlers (Section 15:
 * "Return generic client errors and structured server logs"). Route
 * handlers should never leak stack traces to the client.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: err.issues },
      { status: 400 },
    );
  }
  if (err instanceof ForbiddenError)
    return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof NotFoundError)
    return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof ConflictError)
    return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof InvalidTransitionError)
    return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof Error && err.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (err instanceof RateLimitedError) {
    return NextResponse.json(
      { error: "Too many requests, please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(err.retryAfterMs / 1000)) },
      },
    );
  }
  console.error("Unhandled route error:", err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export interface WithAuthOptions {
  /** Rate-limit scope name (e.g. "ticket-create"); omit to skip rate limiting. */
  rateLimit?: { scope: string; windowMs?: number; max?: number };
}

export async function withAuth<T>(
  handler: (actor: AuthContext) => Promise<T>,
  options: WithAuthOptions = {},
): Promise<NextResponse> {
  try {
    const actor = await requireAuthContext();

    if (options.rateLimit) {
      const key = `${options.rateLimit.scope}:${actor.userId}`;
      const result = checkRateLimit(key, options.rateLimit);
      if (!result.allowed) throw new RateLimitedError(result.retryAfterMs);
    }

    const result = await handler(actor);
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
