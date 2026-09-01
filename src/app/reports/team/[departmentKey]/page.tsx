import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getTeamReport, type AgentMetricRow } from "@/lib/reports/team-report-service";
import { ForbiddenError } from "@/lib/rbac/errors";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

/** UTC-midnight day boundaries, so the range doesn't shift with server timezone. */
function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function defaultRange() {
  const to = new Date(utcMidnight(new Date()).getTime() + DAY_MS); // exclusive, start of tomorrow
  const from = new Date(to.getTime() - 7 * DAY_MS);
  return { from, to };
}

const dateParam = z
  .string()
  .min(1)
  .pipe(z.coerce.date())
  .transform((d) => utcMidnight(d));

function parseRange(raw: { from?: string; to?: string }) {
  const fromResult = raw.from ? dateParam.safeParse(raw.from) : undefined;
  // "to" is a user-facing inclusive day, so the exclusive upper bound
  // passed to the query is the day *after* it.
  const toResult = raw.to ? dateParam.safeParse(raw.to) : undefined;

  const fallback = defaultRange();
  const from = fromResult?.success ? fromResult.data : fallback.from;
  const to = toResult?.success ? new Date(toResult.data.getTime() + DAY_MS) : fallback.to;
  return { from, to };
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type SortKey = "name" | "assigned" | "resolved" | "avg";

function sortRows(
  rows: AgentMetricRow[],
  sort: SortKey,
  dir: "asc" | "desc",
): AgentMetricRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case "assigned":
        return a.assignedCount - b.assignedCount;
      case "resolved":
        return a.resolvedCount - b.resolvedCount;
      case "avg":
        return (a.avgResolutionHours ?? -1) - (b.avgResolutionHours ?? -1);
      case "name":
      default:
        return a.agentName.localeCompare(b.agentName);
    }
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Agent" },
  { key: "assigned", label: "Assigned" },
  { key: "resolved", label: "Resolved" },
  { key: "avg", label: "Avg. resolution (hrs)" },
];

export default async function TeamReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ departmentKey: string }>;
  searchParams: Promise<{ from?: string; to?: string; sort?: string; dir?: string }>;
}) {
  const { departmentKey } = await params;
  const { from: fromRaw, to: toRaw, sort: sortRaw, dir: dirRaw } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const department = await db.department.findFirst({
    where: { key: departmentKey, isActive: true },
  });
  if (!department) return <AccessDenied message="Department not found or inactive." />;

  const { from, to } = parseRange({ from: fromRaw, to: toRaw });
  const sort: SortKey = COLUMNS.some((c) => c.key === sortRaw)
    ? (sortRaw as SortKey)
    : "name";
  const dir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";

  let rows: AgentMetricRow[];
  try {
    rows = await getTeamReport(auth, department.id, { from, to });
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  const sortedRows = sortRows(rows, sort, dir);

  const rangeQuery = `from=${toDateInputValue(from)}&to=${toDateInputValue(
    new Date(to.getTime() - DAY_MS),
  )}`;
  const exportHref = `/api/reports/team/${departmentKey}/export?${rangeQuery}`;

  function sortHref(key: SortKey) {
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    return `/reports/team/${departmentKey}?${rangeQuery}&sort=${key}&dir=${nextDir}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{department.name} team report</h1>
        <p className="text-sm text-muted-foreground">
          Scoped to tickets currently in this department -- a ticket transferred elsewhere
          mid-period no longer counts toward it.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <div>
          <label className="text-sm text-muted-foreground" htmlFor="from">
            From
          </label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={toDateInputValue(from)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm text-muted-foreground" htmlFor="to">
            To
          </label>
          <Input
            id="to"
            name="to"
            type="date"
            defaultValue={toDateInputValue(new Date(to.getTime() - DAY_MS))}
            className="mt-1"
          />
        </div>
        <Button type="submit">Apply</Button>
        <a href={exportHref} className="ml-auto">
          <Button type="button" variant="outline">
            Export CSV
          </Button>
        </a>
      </form>

      {sortedRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No agents in this department.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="p-3 font-medium">
                    <Link href={sortHref(c.key)} className="hover:underline">
                      {c.label}
                      {sort === c.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                    </Link>
                  </th>
                ))}
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.agentId} className="border-b border-border last:border-0">
                  <td className="p-3">{r.agentName}</td>
                  <td className="p-3">{r.assignedCount}</td>
                  <td className="p-3">{r.resolvedCount}</td>
                  <td className="p-3">
                    {r.avgResolutionHours === null
                      ? "—"
                      : r.avgResolutionHours.toFixed(1)}
                  </td>
                  <td
                    className={cn(
                      "p-3 text-xs",
                      !r.stillInDepartment && "text-muted-foreground",
                    )}
                  >
                    {r.stillInDepartment ? "" : "No longer in this department"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Showing {formatDate(from)} through {formatDate(new Date(to.getTime() - DAY_MS))}
          .
        </CardContent>
      </Card>
    </div>
  );
}
