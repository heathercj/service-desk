import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { getTeamReport } from "@/lib/reports/team-report-service";
import { toCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";

const dateParam = z.string().min(1).pipe(z.coerce.date());
const querySchema = z.object({ from: dateParam, to: dateParam });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ departmentKey: string }> },
) {
  const { departmentKey } = await params;

  let actor;
  try {
    actor = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    from: req.nextUrl.searchParams.get("from"),
    to: req.nextUrl.searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const department = await db.department.findUnique({ where: { key: departmentKey } });
    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const rows = await getTeamReport(actor, department.id, {
      from: parsed.data.from,
      to: parsed.data.to,
    });

    const csv = toCsv(rows, [
      { key: "agentName", header: "Agent" },
      { key: "stillInDepartment", header: "Still in department" },
      { key: "assignedCount", header: "Tickets assigned" },
      { key: "resolvedCount", header: "Tickets resolved" },
      { key: "avgResolutionHours", header: "Avg. resolution hours" },
    ]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          `team-report-${departmentKey}.csv`,
        )}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("team report export failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
