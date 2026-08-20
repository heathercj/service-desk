import { NextResponse } from "next/server";

// Liveness only -- no dependency checks (Section 19). Deliberately public
// (see middleware.ts PUBLIC_PATHS) so orchestrators can probe it pre-auth.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
