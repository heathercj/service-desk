import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import {
  getKnowledgeReport,
  type ArticleReportRow,
} from "@/lib/reports/knowledge-report-service";
import { ForbiddenError } from "@/lib/rbac/errors";
import { AccessDenied } from "@/components/access-denied";
import { cn } from "@/lib/utils";

const DEFAULT_STALE_DAYS = 365;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "stale", label: "Needs review" },
  { key: "unused", label: "Unused" },
  { key: "solvers", label: "Top solvers" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

type SortKey = "title" | "age" | "views" | "solved";

function sortRows(rows: ArticleReportRow[], sort: SortKey, dir: "asc" | "desc") {
  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case "age":
        return a.ageInDays - b.ageInDays;
      case "views":
        return a.usageCount - b.usageCount;
      case "solved":
        return a.ticketsSolvedCount - b.ticketsSolvedCount;
      case "title":
      default:
        return a.title.localeCompare(b.title);
    }
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

function filterRows(rows: ArticleReportRow[], filter: FilterKey) {
  switch (filter) {
    case "stale":
      return rows.filter((r) => r.isStale);
    case "unused":
      return rows.filter((r) => r.isUnused);
    case "solvers":
      return [...rows]
        .filter((r) => r.ticketsSolvedCount > 0)
        .sort((a, b) => b.ticketsSolvedCount - a.ticketsSolvedCount);
    case "all":
    default:
      return rows;
  }
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "age", label: "Content age (days)" },
  { key: "views", label: "Views" },
  { key: "solved", label: "Tickets solved" },
];

const staleDaysParam = z.coerce.number().int().positive();

export default async function KnowledgeReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    staleDays?: string;
    filter?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const {
    staleDays: staleDaysRaw,
    filter: filterRaw,
    sort: sortRaw,
    dir: dirRaw,
  } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const parsedStaleDays = staleDaysRaw
    ? staleDaysParam.safeParse(staleDaysRaw)
    : undefined;
  const staleDays = parsedStaleDays?.success ? parsedStaleDays.data : DEFAULT_STALE_DAYS;

  let rows: ArticleReportRow[];
  try {
    rows = await getKnowledgeReport(auth, { staleDays });
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  const filter: FilterKey = FILTERS.some((f) => f.key === filterRaw)
    ? (filterRaw as FilterKey)
    : "all";
  const sort: SortKey = COLUMNS.some((c) => c.key === sortRaw)
    ? (sortRaw as SortKey)
    : "title";
  const dir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";

  const filtered = filterRows(rows, filter);
  const sorted = filter === "solvers" ? filtered : sortRows(filtered, sort, dir);

  function pillHref(key: FilterKey) {
    return `/reports/knowledge?filter=${key}&staleDays=${staleDays}`;
  }

  function sortHref(key: SortKey) {
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    return `/reports/knowledge?filter=${filter}&staleDays=${staleDays}&sort=${key}&dir=${nextDir}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge base health</h1>
        <p className="text-sm text-muted-foreground">
          &ldquo;Needs review&rdquo; is based on when an article&apos;s content last
          actually changed, not when it was last viewed. Threshold: {staleDays} day(s).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={pillHref(f.key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <a
          href={`/api/reports/knowledge/export?staleDays=${staleDays}`}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Export CSV
        </a>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No articles match this view.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="p-3 font-medium">
                    {filter === "solvers" ? (
                      c.label
                    ) : (
                      <Link href={sortHref(c.key)} className="hover:underline">
                        {c.label}
                        {sort === c.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                      </Link>
                    )}
                  </th>
                ))}
                <th className="p-3 font-medium">Department</th>
                <th className="p-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.articleId} className="border-b border-border last:border-0">
                  <td className="p-3">{r.title}</td>
                  <td className="p-3">{r.ageInDays}</td>
                  <td className="p-3">{r.usageCount}</td>
                  <td className="p-3">{r.ticketsSolvedCount}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {r.departmentName}
                  </td>
                  <td className="p-3 text-xs">
                    {r.isStale && <span className="mr-2">Stale</span>}
                    {r.isUnused && <span>Unused</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
