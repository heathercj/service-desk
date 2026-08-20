import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/http/rate-limit";

// Default-deny (Section 3): every route is protected unless explicitly
// listed here. This only proves *authentication*; role/department
// authorization is enforced again, per-operation, in the server-side
// service layer (src/lib/rbac, src/lib/tickets, src/lib/knowledge).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health", "/api/ready", "/favicon.ico"];

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
    const result = checkRateLimit(`auth:${ip}`, { windowMs: 60_000, max: 20 });
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
