import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthContext } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/rbac/errors";
import {
  filterProductOpsRows,
  getProductOpsReport,
} from "@/lib/reports/product-ops-report-service";
import { toCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";

const SIGNAL_FILTERS = ["all", "improvement-ideas", "no-kb", "reopened", "slow"] as const;

const dateParam = z.string().min(1).pipe(z.coerce.date());
const querySchema = z.object({
  from: dateParam,
  to: dateParam,
  signal: z.enum(SIGNAL_FILTERS).default("all"),
});

export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    from: req.nextUrl.searchParams.get("from"),
    to: req.nextUrl.searchParams.get("to"),
    signal: req.nextUrl.searchParams.get("signal") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const allRows = await getProductOpsReport(actor, {
      from: parsed.data.from,
      to: parsed.data.to,
    });
    const rows = filterProductOpsRows(allRows, parsed.data.signal);

    const csv = toCsv(rows, [
      { key: "ticketNumber", header: "Ticket" },
      { key: "subject", header: "Subject" },
      { key: "departmentName", header: "Department" },
      { key: "priority", header: "Priority" },
      { key: "status", header: "Status" },
      { key: "createdAt", header: "Created" },
      { key: "resolvedAt", header: "Resolved" },
      { key: "resolutionHours", header: "Resolution hours" },
      { key: "improvementIdea", header: "Improvement idea" },
      { key: "noKbArticleOpened", header: "No KB article opened" },
      { key: "reopened", header: "Reopened" },
      { key: "slowToResolve", header: "Slow to resolve" },
    ]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="product-ops-report.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("product ops report export failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
