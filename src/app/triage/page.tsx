import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listTriageQueue } from "@/lib/tickets/ticket-service";
import { AccessDenied } from "@/components/access-denied";
import { StatusBadge, PriorityBadge } from "@/components/ticket-badges";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { ForbiddenError } from "@/lib/rbac/errors";

export default async function TriageQueuePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  let result;
  try {
    result = await listTriageQueue(auth, { pageSize: 100 });
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Triage queue</h1>
        <p className="text-sm text-muted-foreground">
          {result.total} ticket(s) awaiting triage.
        </p>
      </div>

      {result.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing to triage right now.
        </p>
      ) : (
        <div className="grid gap-3">
          {result.items.map((t) => (
            <Card key={t.id}>
              <CardContent
                data-tour="triage-row"
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <Link
                    href={`/tickets/${t.ticketNumber}`}
                    data-tour="ticket-link"
                    className="font-medium hover:underline"
                  >
                    {t.ticketNumber} -- {t.subject}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {t.franchise.name} · Submitted dept: {t.submittedDepartment.name}
                    {t.suggestedDepartment
                      ? ` · Suggested: ${t.suggestedDepartment.name}`
                      : ""}{" "}
                    · Age: {formatDate(t.createdAt)}
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
