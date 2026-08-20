import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Readiness (Section 19): confirms the database is actually reachable.
// Graceful failure: returns 503 rather than throwing/crashing the process.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
