# Ticket lifecycle

Source of truth: `src/lib/tickets/state-machine.ts` (unit tested in
`state-machine.test.ts`). Department scoping (which department's agents may
act) is checked separately by `ticket-service.ts` and is not shown here.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> SUBMITTED: Customer submits

    SUBMITTED --> IN_TRIAGE: Triage/Admin

    IN_TRIAGE --> WAITING_FOR_CUSTOMER: Triage/Admin
    IN_TRIAGE --> QUEUED: Triage/Admin confirms triage

    WAITING_FOR_CUSTOMER --> IN_TRIAGE: Customer replies (pre-routing)
    WAITING_FOR_CUSTOMER --> IN_PROGRESS: Customer replies (post-routing)

    QUEUED --> ASSIGNED: Agent self-assigns / Manager assigns

    ASSIGNED --> IN_PROGRESS: Agent starts work
    ASSIGNED --> QUEUED: Unassigned

    IN_PROGRESS --> WAITING_FOR_CUSTOMER: Agent needs info
    IN_PROGRESS --> PENDING: Blocked (e.g. vendor)
    IN_PROGRESS --> RESOLUTION_REVIEW: Agent submits resolution

    PENDING --> IN_PROGRESS: Unblocked

    RESOLUTION_REVIEW --> IN_PROGRESS: Resolution attempt withdrawn
    RESOLUTION_REVIEW --> RESOLVED: Resolution gate passes

    RESOLVED --> CLOSED: Agent/Manager/Admin closes
    RESOLVED --> REOPENED: Customer/Agent/Manager/Admin (reason required)
    CLOSED --> REOPENED: Customer/Agent/Manager/Admin (reason required)

    REOPENED --> QUEUED: Routed back to queue
    REOPENED --> IN_PROGRESS: Resumed directly

    SUBMITTED --> CANCELLED: Triage/Manager/Admin (reason required)
    IN_TRIAGE --> CANCELLED: Triage/Manager/Admin (reason required)
    WAITING_FOR_CUSTOMER --> CANCELLED: Triage/Manager/Admin (reason required)
    QUEUED --> CANCELLED: Triage/Manager/Admin (reason required)
    ASSIGNED --> CANCELLED: Triage/Manager/Admin (reason required)
    IN_PROGRESS --> CANCELLED: Triage/Manager/Admin (reason required)
    PENDING --> CANCELLED: Triage/Manager/Admin (reason required)
    RESOLUTION_REVIEW --> CANCELLED: Triage/Manager/Admin (reason required)

    CLOSED --> [*]
    CANCELLED --> [*]
```

## Notes

- **`DRAFT` is modeled but not used by the current UI.** Tickets are created
  directly in `SUBMITTED` -- there is no client-side autosave-before-submit
  flow in this prototype pass. The transition exists so a future
  autosave/draft feature has a status to land in without a schema change.
- **Reason required**: cancellation, reopen, and department transfer all
  require a non-empty reason, enforced by `assertTransition()` /
  `transferDepartment()`. The reason is stored in `TicketStatusHistory`
  (or `TicketDepartmentHistory` for transfers) and shown in the ticket
  timeline.
- **Mis-route transfer**: `transferDepartment()` can name a new assignee in
  the same call as the department change -- for the case where a ticket
  landed in the wrong department *and* with the wrong owner. The ticket's
  current assignee may initiate this themselves (not only a manager, triage
  agent, or admin, per `canTransferDepartment()`); the named assignee must
  belong to the destination department, and is emailed via the same
  mechanism that notifies customers of staff replies (`getEmailProvider()`,
  captured to `/dev-mailbox` in development). Omitting the new assignee
  keeps the original behavior: the ticket is requeued unassigned in the new
  department.
- **Resolution only via `RESOLUTION_REVIEW`**: there is no direct
  `IN_PROGRESS -> RESOLVED` transition. Submitting a resolution always
  lands the ticket in `RESOLUTION_REVIEW` first; it only continues to
  `RESOLVED` if the resolution gate (docs/KNOWLEDGE_LIFECYCLE.md) passes at
  that moment. If it doesn't, the ticket stays in `RESOLUTION_REVIEW` until
  a valid knowledge outcome is recorded and resolution is re-attempted.
- **Optimistic concurrency**: every transition requires the caller to
  supply the `version` it last read. A stale `version` produces a `409`
  (`ConflictError`), never a silent overwrite.
- **Every transition is recorded** in `TicketStatusHistory` with actor,
  timestamp, from/to status, and reason (if any) -- this is the ticket
  timeline shown on the detail page.
