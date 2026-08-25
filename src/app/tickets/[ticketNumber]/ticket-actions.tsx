"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { DEPARTMENT_KEYS } from "@/lib/validation/ticket-schemas";
import { titleCase } from "@/lib/utils";

interface DepartmentAgentOption {
  id: string;
  displayName: string;
}

interface TicketActionsProps {
  ticket: {
    id: string;
    ticketNumber: string;
    status: string;
    version: number;
    departmentKey: string;
  };
  roles: string[];
  /** Whether the signed-in user is this ticket's current assignee. */
  isAssignee: boolean;
  allowedNextStatuses: string[];
  knowledgeLinks: Array<{ id: string; outcomeType: string; articleTitle: string | null }>;
  departmentAgents: Record<string, DepartmentAgentOption[]>;
}

const CANCEL_ROLES = new Set(["TRIAGE_AGENT", "DEPARTMENT_MANAGER", "ADMINISTRATOR"]);
const REOPEN_ROLES = new Set([
  "CUSTOMER",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "ADMINISTRATOR",
]);
const TRANSFER_ROLES = new Set(["TRIAGE_AGENT", "DEPARTMENT_MANAGER", "ADMINISTRATOR"]);
const AGENT_ROLES = new Set(["DEPARTMENT_AGENT", "DEPARTMENT_MANAGER", "ADMINISTRATOR"]);

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Request failed");
  }
  return res.json();
}

export function TicketActions({
  ticket,
  roles,
  isAssignee,
  allowedNextStatuses,
  knowledgeLinks,
  departmentAgents,
}: TicketActionsProps) {
  const router = useRouter();
  const roleSet = new Set(roles);
  const [error, setError] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [resolutionSteps, setResolutionSteps] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferDeptKey, setTransferDeptKey] = useState(ticket.departmentKey);
  const [transferAssigneeId, setTransferAssigneeId] = useState("");
  const [triageDept, setTriageDept] = useState(ticket.departmentKey);
  const [triageAssigneeId, setTriageAssigneeId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [gateReasons, setGateReasons] = useState<string[] | null>(null);

  const cancelDialog = useRef<ConfirmDialogHandle>(null);
  const reopenDialog = useRef<ConfirmDialogHandle>(null);
  const transferDialog = useRef<ConfirmDialogHandle>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const canReply = ticket.status !== "CLOSED" && ticket.status !== "CANCELLED";
  const canAddNote =
    [...roleSet].some((r) => AGENT_ROLES.has(r)) || roleSet.has("TRIAGE_AGENT");
  const isTriageEligible =
    (roleSet.has("TRIAGE_AGENT") || roleSet.has("ADMINISTRATOR")) &&
    ["SUBMITTED", "IN_TRIAGE"].includes(ticket.status);
  const canSelfAssign =
    [...roleSet].some((r) => AGENT_ROLES.has(r)) && ticket.status === "QUEUED";
  const canResolve =
    [...roleSet].some((r) => AGENT_ROLES.has(r)) &&
    ["IN_PROGRESS", "PENDING", "RESOLUTION_REVIEW"].includes(ticket.status);
  const canTransfer =
    ([...roleSet].some((r) => TRANSFER_ROLES.has(r)) || isAssignee) &&
    !["RESOLVED", "CLOSED", "CANCELLED"].includes(ticket.status);
  const canCancel =
    [...roleSet].some((r) => CANCEL_ROLES.has(r)) &&
    !["RESOLVED", "CLOSED", "CANCELLED"].includes(ticket.status);
  const canReopen =
    [...roleSet].some((r) => REOPEN_ROLES.has(r)) &&
    ["RESOLVED", "CLOSED"].includes(ticket.status);

  const plainTransitions = allowedNextStatuses.filter(
    (s) => !["CANCELLED", "REOPENED", "RESOLVED", "RESOLUTION_REVIEW"].includes(s),
  );

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {canReply && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send a message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              data-tour="message-body"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              rows={3}
            />
            <Button
              data-tour="message-send"
              disabled={busy || !messageBody.trim()}
              onClick={() =>
                run(async () => {
                  await post(`/api/tickets/${ticket.id}/messages`, {
                    body: messageBody,
                    version: ticket.version,
                  });
                  setMessageBody("");
                })
              }
            >
              Send
            </Button>
          </CardContent>
        </Card>
      )}

      {canAddNote && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add internal note</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={3}
            />
            <Button
              variant="outline"
              disabled={busy || !noteBody.trim()}
              onClick={() =>
                run(async () => {
                  await post(`/api/tickets/${ticket.id}/notes`, { body: noteBody });
                  setNoteBody("");
                })
              }
            >
              Add note
            </Button>
          </CardContent>
        </Card>
      )}

      {isTriageEligible && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirm triage &amp; route</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="text-sm">
              Department
              <Select
                value={triageDept}
                onChange={(e) => {
                  setTriageDept(e.target.value);
                  setTriageAssigneeId("");
                }}
                className="mt-1"
              >
                {DEPARTMENT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {titleCase(k)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              Assign directly to (optional)
              <Select
                value={triageAssigneeId}
                onChange={(e) => setTriageAssigneeId(e.target.value)}
                className="mt-1"
              >
                <option value="">Leave in queue (unassigned)</option>
                {(departmentAgents[triageDept] ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              data-tour="triage-confirm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post(`/api/tickets/${ticket.id}/triage`, {
                    version: ticket.version,
                    departmentKey: triageDept,
                    priority: "MEDIUM",
                    tags: [],
                    assigneeId: triageAssigneeId || undefined,
                  });
                })
              }
            >
              {triageAssigneeId
                ? `Confirm triage, route to ${titleCase(triageDept)}, and assign`
                : `Confirm triage & route to ${titleCase(triageDept)}`}
            </Button>
          </CardContent>
        </Card>
      )}

      {canSelfAssign && (
        <Button
          data-tour="assign-self"
          disabled={busy}
          onClick={() =>
            run(async () =>
              post(`/api/tickets/${ticket.id}/assign-self`, { version: ticket.version }),
            )
          }
        >
          Assign to me
        </Button>
      )}

      {plainTransitions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plainTransitions.map((status) => (
            <Button
              key={status}
              data-tour={`transition-${status}`}
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  post(`/api/tickets/${ticket.id}/transition`, {
                    version: ticket.version,
                    toStatus: status,
                  }),
                )
              }
            >
              Move to {titleCase(status)}
            </Button>
          ))}
        </div>
      )}

      {canResolve && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolve ticket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="text-sm">
              Resolution summary
              <Textarea
                data-tour="resolution-summary"
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                rows={2}
              />
            </label>
            <label className="text-sm">
              Resolution steps
              <Textarea
                data-tour="resolution-steps"
                value={resolutionSteps}
                onChange={(e) => setResolutionSteps(e.target.value)}
                rows={3}
              />
            </label>
            <Button
              data-tour="resolution-submit"
              disabled={busy || !resolutionSummary.trim() || !resolutionSteps.trim()}
              onClick={() =>
                run(async () => {
                  const result = await post(`/api/tickets/${ticket.id}/resolve`, {
                    version: ticket.version,
                    resolutionSummary,
                    resolutionSteps,
                  });
                  setGateReasons(
                    result.gate?.ok ? null : (result.gate?.blockingReasons ?? null),
                  );
                })
              }
            >
              Submit resolution
            </Button>
            {gateReasons && (
              <div
                data-tour="resolution-gate"
                className="rounded-md border border-warning bg-warning/10 p-3 text-sm"
              >
                <p className="font-medium">Cannot resolve yet:</p>
                <ul className="mt-1 list-disc pl-5">
                  {gateReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Run a knowledge similarity check and record an outcome (link/update/new
                  draft/exception) below, then resubmit.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {knowledgeLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Knowledge outcome</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {knowledgeLinks.map((l) => (
              <p key={l.id}>
                {titleCase(l.outcomeType)}
                {l.articleTitle ? `: ${l.articleTitle}` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {canTransfer && (
          <Button
            variant="outline"
            data-tour="transfer-open"
            onClick={() => transferDialog.current?.open()}
          >
            Transfer department
          </Button>
        )}
        {canCancel && (
          <Button variant="destructive" onClick={() => cancelDialog.current?.open()}>
            Cancel ticket
          </Button>
        )}
        {canReopen && (
          <Button variant="outline" onClick={() => reopenDialog.current?.open()}>
            Reopen ticket
          </Button>
        )}
      </div>

      <ConfirmDialog
        ref={transferDialog}
        title="Transfer to another department"
        description={
          transferAssigneeId
            ? "This will move the ticket to a new department queue and assign it to the person you chose."
            : "This will move the ticket to a new department queue and clear its current assignee."
        }
        confirmLabel="Transfer"
        onConfirm={() =>
          run(async () => {
            await post(`/api/tickets/${ticket.id}/transfer`, {
              version: ticket.version,
              departmentKey: transferDeptKey,
              reason: transferReason,
              newAssigneeId: transferAssigneeId || undefined,
            });
          })
        }
      />
      <ConfirmDialog
        ref={cancelDialog}
        title="Cancel this ticket"
        description="This requires a reason and will be recorded in the audit trail."
        confirmLabel="Cancel ticket"
        destructive
        onConfirm={() =>
          run(async () => {
            await post(`/api/tickets/${ticket.id}/transition`, {
              version: ticket.version,
              toStatus: "CANCELLED",
              reason: cancelReason || "No reason provided",
            });
          })
        }
      />

      <ConfirmDialog
        ref={reopenDialog}
        title="Reopen this ticket"
        description="This requires a reason and will be recorded in the audit trail."
        confirmLabel="Reopen"
        onConfirm={() =>
          run(async () => {
            await post(`/api/tickets/${ticket.id}/transition`, {
              version: ticket.version,
              toStatus: "REOPENED",
              reason: reopenReason || "No reason provided",
            });
          })
        }
      />

      {(canCancel || canReopen || canTransfer) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reasons for the actions above</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {canTransfer && (
              <label className="text-xs">
                New department
                <Select
                  value={transferDeptKey}
                  onChange={(e) => {
                    setTransferDeptKey(e.target.value);
                    setTransferAssigneeId("");
                  }}
                  className="mt-1"
                >
                  {DEPARTMENT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {titleCase(k)}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {canTransfer && (
              <label className="text-xs">
                New assignee
                <Select
                  value={transferAssigneeId}
                  onChange={(e) => setTransferAssigneeId(e.target.value)}
                  className="mt-1"
                >
                  <option value="">Leave unassigned in new department</option>
                  {(departmentAgents[transferDeptKey] ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {canTransfer && (
              <label className="text-xs">
                Transfer reason
                <Input
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                />
              </label>
            )}
            {canCancel && (
              <label className="text-xs">
                Cancel reason
                <Input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </label>
            )}
            {canReopen && (
              <label className="text-xs">
                Reopen reason
                <Input
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                />
              </label>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
