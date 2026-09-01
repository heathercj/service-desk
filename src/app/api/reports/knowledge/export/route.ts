import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/rbac/errors";
import { getKnowledgeReport } from "@/lib/reports/knowledge-report-service";
import { toCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";

const querySchema = z.object({
  staleDays: z.coerce.number().int().positive().optional(),
});

export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    staleDays: req.nextUrl.searchParams.get("staleDays") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid staleDays" }, { status: 400 });
  }

  try {
    const rows = await getKnowledgeReport(actor, { staleDays: parsed.data.staleDays });

    const csv = toCsv(rows, [
      { key: "title", header: "Title" },
      { key: "departmentName", header: "Department" },
      { key: "status", header: "Status" },
      { key: "contentUpdatedAt", header: "Content last updated" },
      { key: "ageInDays", header: "Age (days)" },
      { key: "usageCount", header: "Views" },
      { key: "helpfulCount", header: "Helpful" },
      { key: "notHelpfulCount", header: "Not helpful" },
      { key: "deflectionCount", header: "Deflections" },
      { key: "ticketsSolvedCount", header: "Tickets solved" },
      { key: "isStale", header: "Stale" },
      { key: "isUnused", header: "Unused" },
    ]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="knowledge-report.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("knowledge report export failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
