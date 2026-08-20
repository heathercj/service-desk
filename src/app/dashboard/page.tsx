import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listMyTickets } from "@/lib/tickets/ticket-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ticket-badges";
import { ChatWidget } from "@/components/chat-widget";
import { formatDate } from "@/lib/utils";
import type { TicketStatus } from "@prisma/client";

const OPEN_STATUSES: TicketStatus[] = [
  "SUBMITTED",
  "IN_TRIAGE",
  "QUEUED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING",
  "RESOLUTION_REVIEW",
  "REOPENED",
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!auth.roles.has("CUSTOMER")) redirect("/");

  const { q, status } = await searchParams;

  const { items } = await listMyTickets(auth, {
    search: q,
    status: status ? [status as TicketStatus] : undefined,
    pageSize: 100,
  });

  const open = items.filter((t) => OPEN_STATUSES.includes(t.status));
  const waiting = items.filter((t) => t.status === "WAITING_FOR_CUSTOMER");
  const resolved = items.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My tickets</h1>
          <p className="text-sm text-muted-foreground">
            Track requests you&apos;ve submitted to the service desk.
          </p>
        </div>
        <div className="flex gap-2">
          <ChatWidget />
          <Button asChild>
            <Link href="/tickets/new">Create ticket</Link>
          </Button>
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by subject or ticket number"
          className="max-w-xs"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All statuses</option>
          {OPEN_STATUSES.concat([
            "WAITING_FOR_CUSTOMER" as TicketStatus,
            "RESOLVED",
            "CLOSED",
            "CANCELLED",
          ]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <TicketSection
        title="Open tickets"
        tickets={open}
        emptyMessage="You have no open tickets."
      />
      <TicketSection
        title="Waiting for your response"
        tickets={waiting}
        emptyMessage="Nothing is waiting on you right now."
      />
      <TicketSection
        title="Recently resolved"
        tickets={resolved.slice(0, 10)}
        emptyMessage="No resolved tickets yet."
      />
    </div>
  );
}

function TicketSection({
  title,
  tickets,
  emptyMessage,
}: {
  title: string;
  tickets: Array<{
    id: string;
    ticketNumber: string;
    subject: string;
    status: string;
    priority: string;
    priorityCustomerVisible: boolean;
    createdAt: Date;
    updatedAt: Date;
    department: { name: string };
  }>;
  emptyMessage: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {tickets.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="grid gap-3">
          {tickets.map((t) => (
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
                    {t.department.name} · Created {formatDate(t.createdAt)} · Updated{" "}
                    {formatDate(t.updatedAt)}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
