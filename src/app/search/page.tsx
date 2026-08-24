import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { searchTickets } from "@/lib/tickets/ticket-service";
import { AccessDenied } from "@/components/access-denied";
import { StatusBadge, PriorityBadge, DepartmentBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

const SEARCH_ROLES = new Set([
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "ADMINISTRATOR",
]);

export default async function TicketSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const canSearch = [...auth.roles].some((r) => SEARCH_ROLES.has(r));
  if (!canSearch) {
    return <AccessDenied message="Only staff can search tickets." />;
  }

  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const result = query
    ? await searchTickets(auth, { query, pageSize: 50 })
    : { items: [], total: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search tickets</h1>
        <p className="text-sm text-muted-foreground">
          Find a ticket by SD number or by keyword in its subject or description.
        </p>
      </div>

      <form className="flex flex-wrap items-center gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder='e.g. SD-000123 or "VPN"'
          className="max-w-sm"
        />
        <Button type="submit">Search</Button>
      </form>

      {query && (
        <p className="text-sm text-muted-foreground">
          {result.total} result{result.total === 1 ? "" : "s"} for &quot;{query}&quot;
        </p>
      )}

      {query && result.items.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No tickets match that search.
        </p>
      )}

      {result.items.length > 0 && (
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
                    {t.department.name} ·{" "}
                    {t.assignee ? `Assigned to ${t.assignee.displayName}` : "Unassigned"}{" "}
                    · Created {formatDate(t.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <DepartmentBadge name={t.department.name} />
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
