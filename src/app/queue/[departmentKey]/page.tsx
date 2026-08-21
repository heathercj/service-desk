import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listDepartmentQueue, type TicketListFilters } from "@/lib/tickets/ticket-service";
import { LIVE_STATUSES } from "@/lib/tickets/state-machine";
import { canViewDepartmentWorkload, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { StatusBadge, PriorityBadge } from "@/components/ticket-badges";
import { Card, CardContent } from "@/components/ui/card";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { formatDate, cn } from "@/lib/utils";

const VIEWS = [
  { key: "all", label: "All" },
  { key: "mine", label: "Assigned to me" },
  { key: "triage", label: "In Triage" },
  { key: "in-progress", label: "In Progress (Others)" },
  { key: "on-hold", label: "On Hold (Others)" },
  { key: "waiting", label: "Waiting on Customer (Others)" },
  { key: "reopened", label: "Reopened" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"] | "resolved";

function viewFilters(view: ViewKey, userId: string): TicketListFilters {
  switch (view) {
    case "mine":
      return { status: [...LIVE_STATUSES], assigneeId: userId };
    case "triage":
      return { status: ["SUBMITTED", "IN_TRIAGE"] };
    case "in-progress":
      return { status: ["IN_PROGRESS"], assignedToOtherThan: userId };
    case "on-hold":
      return { status: ["PENDING"], assignedToOtherThan: userId };
    case "waiting":
      return { status: ["WAITING_FOR_CUSTOMER"], assignedToOtherThan: userId };
    case "reopened":
      return { status: ["REOPENED"] };
    case "resolved":
      return { status: ["RESOLVED", "CLOSED", "CANCELLED"] };
    case "all":
    default:
      return { status: [...LIVE_STATUSES] };
  }
}

export default async function DepartmentQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ departmentKey: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { departmentKey } = await params;
  const { view: rawView } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const view: ViewKey =
    rawView === "resolved" || VIEWS.some((v) => v.key === rawView)
      ? (rawView as ViewKey)
      : "all";

  const department = await db.department.findFirst({
    where: { key: departmentKey as never, isActive: true },
  });
  if (!department) return <AccessDenied message="Department not found or inactive." />;

  let result;
  try {
    result = await listDepartmentQueue(auth, department.id, {
      ...viewFilters(view, auth.userId),
      pageSize: 100,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    if (err instanceof NotFoundError)
      return <AccessDenied message="Department not found." />;
    throw err;
  }

  const policyActor = toPolicyActor(auth);
  const isManager = canViewDepartmentWorkload(policyActor, department.id);

  const counts = result.items.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{department.name} queue</h1>
        <p className="text-sm text-muted-foreground">{result.total} ticket(s).</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/queue/${departmentKey}?view=${v.key}`}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                view === v.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <Link
          href={`/queue/${departmentKey}?view=resolved`}
          className={cn(
            "ml-auto rounded-md border px-3 py-1.5 text-sm",
            view === "resolved"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          Show resolved tickets
        </Link>
      </div>

      {isManager && (
        <Card>
          <CardContent className="flex flex-wrap gap-4 p-4 text-sm">
            {Object.entries(counts).map(([status, count]) => (
              <span key={status}>
                <strong>{count}</strong> {status}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      {result.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No tickets in this department queue.
        </p>
      ) : (
        <div className="grid gap-3">
          {result.items.map((t) => (
            <Card key={t.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link
                    href={`/tickets/${t.ticketNumber}`}
                    className="font-medium hover:underline"
                  >
                    {t.ticketNumber} -- {t.subject}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {t.assignee ? `Assigned to ${t.assignee.displayName}` : "Unassigned"}{" "}
                    · Created {formatDate(t.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <StatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
