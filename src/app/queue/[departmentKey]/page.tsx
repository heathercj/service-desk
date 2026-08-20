import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listDepartmentQueue } from "@/lib/tickets/ticket-service";
import { canViewDepartmentWorkload, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { StatusBadge, PriorityBadge } from "@/components/ticket-badges";
import { Card, CardContent } from "@/components/ui/card";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { formatDate } from "@/lib/utils";

export default async function DepartmentQueuePage({
  params,
}: {
  params: Promise<{ departmentKey: string }>;
}) {
  const { departmentKey } = await params;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const department = await db.department.findFirst({
    where: { key: departmentKey as never, isActive: true },
  });
  if (!department) return <AccessDenied message="Department not found or inactive." />;

  let result;
  try {
    result = await listDepartmentQueue(auth, department.id, { pageSize: 100 });
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
