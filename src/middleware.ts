import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/http/rate-limit";

// Default-deny (Section 3): every route is protected unless explicitly
// listed here. This only proves *authentication*; role/department
// authorization is enforced again, per-operation, in the server-side
// service layer (src/lib/rbac, src/lib/tickets, src/lib/knowledge).
// /api/webhooks/graph-email is unauthenticated by design -- Microsoft Graph
// calls it directly, with no session to present. It is protected instead by
// GRAPH_WEBHOOK_CLIENT_STATE, checked inside the route itself (see
// docs/ENTRA_SETUP.md and src/app/api/webhooks/graph-email/route.ts).
const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/ready",
  "/api/webhooks/graph-email",
  "/favicon.ico",
];

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((req: NextRequest & { auth?: unknown }) => {
  const { pathname } = req.nextUrl;

  // Login-sensitive rate limiting (Section 15), keyed by IP since these
  // requests are unauthenticated by definition.
  if (
    pathname.startsWith("/api/auth/signin") ||
    pathname.startsWith("/api/auth/callback")
  ) {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    // Note what the fallback means: with no x-forwarded-for -- which is every
    // request that has not come through a proxy, including all of localhost --
    // this is ONE bucket for all callers, not one per caller. That is the safe
    // direction for a security control and the hostile direction for a
    // parallel test suite, which is why the limit is configurable.
    const result = checkRateLimit(`auth:${ip}`, {
      windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
      max: env.RATE_LIMIT_AUTH_MAX,
    });
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Too many sign-in attempts, please slow down." },
        { status: 429 },
      );
    }
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
