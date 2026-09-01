import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import {
  filterProductOpsRows,
  getProductOpsReport,
  type ProductOpsRow,
  type ProductOpsSignalFilter,
} from "@/lib/reports/product-ops-report-service";
import { ForbiddenError } from "@/lib/rbac/errors";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function defaultRange() {
  const to = new Date(utcMidnight(new Date()).getTime() + DAY_MS); // exclusive, start of tomorrow
  const from = new Date(to.getTime() - 90 * DAY_MS); // wider than the team report: discovery needs more history
  return { from, to };
}

const dateParam = z
  .string()
  .min(1)
  .pipe(z.coerce.date())
  .transform((d) => utcMidnight(d));

function parseRange(raw: { from?: string; to?: string }) {
  const fromResult = raw.from ? dateParam.safeParse(raw.from) : undefined;
  const toResult = raw.to ? dateParam.safeParse(raw.to) : undefined;

  const fallback = defaultRange();
  const from = fromResult?.success ? fromResult.data : fallback.from;
  const to = toResult?.success ? new Date(toResult.data.getTime() + DAY_MS) : fallback.to;
  return { from, to };
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const FILTERS: Array<{ key: ProductOpsSignalFilter; label: string }> = [
  { key: "all", label: "Any signal" },
  { key: "improvement-ideas", label: "Improvement ideas" },
  { key: "no-kb", label: "No KB article opened" },
  { key: "reopened", label: "Reopened" },
  { key: "slow", label: "Slow to resolve" },
];

function isSignalFilter(value: string | undefined): value is ProductOpsSignalFilter {
  return FILTERS.some((f) => f.key === value);
}

function flagLabels(row: ProductOpsRow): string[] {
  const flags: string[] = [];
  if (row.improvementIdea) flags.push("Improvement idea");
  if (row.noKbArticleOpened) flags.push("No KB article opened");
  if (row.reopened) flags.push("Reopened");
  if (row.slowToResolve) flags.push("Slow to resolve");
  return flags;
}

export default async function ProductOpsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; signal?: string }>;
}) {
  const { from: fromRaw, to: toRaw, signal: signalRaw } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const { from, to } = parseRange({ from: fromRaw, to: toRaw });
  const signal: ProductOpsSignalFilter = isSignalFilter(signalRaw) ? signalRaw : "all";

  let rows: ProductOpsRow[];
  try {
    rows = await getProductOpsReport(auth, { from, to });
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  const filtered = filterProductOpsRows(rows, signal);

  const lastDayInclusive = toDateInputValue(new Date(to.getTime() - DAY_MS));
  const rangeQuery = `from=${toDateInputValue(from)}&to=${lastDayInclusive}`;
  const exportHref = `/api/reports/product/export?${rangeQuery}&signal=${signal}`;

  function pillHref(key: ProductOpsSignalFilter) {
    return `/reports/product?${rangeQuery}&signal=${key}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Product signals</h1>
        <p className="text-sm text-muted-foreground">
          A raw ticket feed, not a pre-ranked list -- these are the tickets worth reading,
          not a verdict on what to build. &ldquo;No KB article opened&rdquo; means the
          customer opened none of the articles suggested at intake; the form doesn&apos;t
          record whether anything relevant was actually suggested, so this can mean either
          nothing relevant existed, or it did and they didn&apos;t look.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="signal" value={signal} />
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
            defaultValue={lastDayInclusive}
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

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={pillHref(f.key)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              signal === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No tickets match this view in the selected range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="p-3 font-medium">Ticket</th>
                <th className="p-3 font-medium">Department</th>
                <th className="p-3 font-medium">Priority</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Created</th>
                <th className="p-3 font-medium">Resolution (hrs)</th>
                <th className="p-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticketId} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/tickets/${r.ticketNumber}`}
                      className="font-medium hover:underline"
                    >
                      {r.ticketNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.subject}</p>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {r.departmentName}
                  </td>
                  <td className="p-3">{r.priority}</td>
                  <td className="p-3">{r.status}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="p-3">
                    {r.resolutionHours === null ? "—" : r.resolutionHours.toFixed(1)}
                  </td>
                  <td className="p-3 text-xs">{flagLabels(r).join(", ")}</td>
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
