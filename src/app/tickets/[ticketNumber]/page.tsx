import { redirect, notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getTicketByNumberForActor } from "@/lib/tickets/ticket-service";
import { listAgentsByDepartment } from "@/lib/tickets/department-lookup";
import { getAllowedNextStatuses } from "@/lib/tickets/state-machine";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { canRecordKnowledgeException, toPolicyActor } from "@/lib/rbac/policies";
import {
  attachLastActivityAt,
  isTicketStale,
} from "@/lib/tickets/dormant-ticket-service";
import { AccessDenied } from "@/components/access-denied";
import {
  StatusBadge,
  PriorityBadge,
  DepartmentBadge,
  DormantBadge,
} from "@/components/ticket-badges";
import { SafeExternalLink } from "@/components/safe-external-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { env } from "@/lib/env";
import { TicketActions } from "./ticket-actions";
import { KnowledgeOutcomePanel } from "./knowledge-outcome-panel";
import { AttachmentUploader } from "./attachment-uploader";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketNumber: string }>;
}) {
  const { ticketNumber } = await params;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  let data;
  try {
    data = await getTicketByNumberForActor(auth, ticketNumber);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  const {
    ticket,
    urls,
    attachments,
    conversation,
    internalNotes,
    statusHistory,
    knowledgeLinks,
    includeInternal,
  } = data;

  const isStaffView = includeInternal;
  const allowedNextStatuses = getAllowedNextStatuses(ticket.status, auth.roles);

  const departmentAgents = isStaffView ? await listAgentsByDepartment() : {};

  const [ticketActivity] = await attachLastActivityAt([ticket]);
  const isDormant =
    isStaffView &&
    ticket.assigneeId != null &&
    isTicketStale(ticketActivity!.lastActivityAt, new Date());

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{ticket.ticketNumber}</p>
            <CardTitle className="text-xl">{ticket.subject}</CardTitle>
            {ticket.source === "EMAIL" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Received via {env.SUPPORT_MAILBOX_ADDRESS || "email"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* The tour watches this span's text to know a transition
                landed; keep the badge its only child. */}
            <span data-tour="ticket-status">
              <StatusBadge status={ticket.status} />
            </span>
            {ticket.priorityCustomerVisible || isStaffView ? (
              <PriorityBadge priority={ticket.priority} />
            ) : null}
            <DepartmentBadge name={ticket.department.name} />
            {isDormant && <DormantBadge />}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Franchise" value={ticket.franchise.name} />
          <Field
            label="Submitted by"
            value={`${ticket.submittedName} (${ticket.submittedEmail})`}
          />
          <Field label="Created" value={formatDateTime(ticket.createdAt)} />
          <Field label="Last updated" value={formatDateTime(ticket.updatedAt)} />
          {ticket.isProjectRelated && (
            <Field label="Project number" value={ticket.projectNumber ?? "--"} />
          )}
          {isStaffView && (
            <Field
              label="Assignee"
              value={ticket.assignee?.displayName ?? "Unassigned"}
            />
          )}
          {isStaffView && ticket.category && (
            <Field label="Category" value={ticket.category} />
          )}
          {isStaffView && ticket.impact && <Field label="Impact" value={ticket.impact} />}
          {isStaffView && ticket.suggestedDepartmentRationale && (
            <Field
              label={
                ticket.suggestedDepartment
                  ? "Suggested department"
                  : "Auto-routed because"
              }
              value={
                ticket.suggestedDepartment
                  ? `${ticket.suggestedDepartment.name} -- ${ticket.suggestedDepartmentRationale}`
                  : ticket.suggestedDepartmentRationale
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Description</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm">
          {ticket.description}
        </CardContent>
      </Card>

      {urls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submitted links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {urls.map((u) => (
              <SafeExternalLink key={u.id} url={u.url} hostname={u.hostname} />
            ))}
          </CardContent>
        </Card>
      )}

      {!["CLOSED", "CANCELLED"].includes(ticket.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attachments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {attachments.length === 0 && (
              <p className="text-muted-foreground">No attachments yet.</p>
            )}
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 rounded border border-border p-2"
              >
                <span>{a.originalFilename}</span>
                <div className="flex items-center gap-2">
                  <ScanStatusBadge status={a.scanStatus} />
                  {a.scanStatus === "CLEAN" && (
                    <a
                      href={`/api/attachments/${a.id}/download`}
                      className="text-primary underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))}
            <AttachmentUploader ticketId={ticket.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {conversation.length === 0 && (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          )}
          {conversation.map((m) => (
            <div
              key={m.id}
              className={`rounded-md border p-3 text-sm ${m.isFromCustomer ? "border-border" : "border-primary/40 bg-primary/5"}`}
            >
              <p className="mb-1 text-xs text-muted-foreground">
                {m.isFromCustomer ? "Customer" : "Staff"} · {formatDateTime(m.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {isStaffView && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Internal notes (staff only)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {internalNotes.length === 0 && (
              <p className="text-sm text-muted-foreground">No internal notes yet.</p>
            )}
            {internalNotes.map((n) => (
              <div
                key={n.id}
                className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {formatDateTime(n.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isStaffView &&
        ["IN_PROGRESS", "PENDING", "RESOLUTION_REVIEW"].includes(ticket.status) && (
          <KnowledgeOutcomePanel
            ticketId={ticket.id}
            ticketSubject={ticket.subject}
            ticketDescription={ticket.description}
            departmentKey={ticket.department.key}
            canRecordException={canRecordKnowledgeException(toPolicyActor(auth))}
          />
        )}

      <TicketActions
        ticket={{
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          status: ticket.status,
          version: ticket.version,
          departmentKey: ticket.department.key,
        }}
        roles={Array.from(auth.roles)}
        isAssignee={ticket.assigneeId === auth.userId}
        allowedNextStatuses={allowedNextStatuses}
        knowledgeLinks={knowledgeLinks.map((l) => ({
          id: l.id,
          outcomeType: l.outcomeType,
          articleTitle: l.article?.title ?? null,
        }))}
        departmentAgents={departmentAgents}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1 text-sm text-muted-foreground">
            {statusHistory.map((h) => (
              <li key={h.id}>
                {formatDateTime(h.createdAt)}: {h.fromStatus ?? "(new)"} &rarr;{" "}
                {h.toStatus}
                {h.reason ? ` -- ${h.reason}` : ""}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function ScanStatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    PENDING: "Scanning...",
    CLEAN: "Clean",
    REJECTED: "Rejected",
    SCAN_UNAVAILABLE: "Scan unavailable",
  };
  return <span className="text-xs text-muted-foreground">{label[status] ?? status}</span>;
}
