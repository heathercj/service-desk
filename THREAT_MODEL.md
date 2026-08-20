# Threat model

Lightweight STRIDE-style pass over the prototype's trust boundaries. This is
a prototype-scope threat model -- production hardening should redo this
exercise against the real deployment topology.

## Assets

- Ticket content (may include sensitive Accounting Services / Legal
  material)
- Internal notes (never customer-visible)
- Knowledge articles (may reference internal process)
- Attachments (arbitrary user-uploaded files)
- Audit trail (accountability record)
- Session tokens / Entra credentials

## Trust boundaries

```
Browser  --(HTTPS)-->  Next.js server  --(TLS, parameterized SQL)-->  Postgres
                              |
                              +--(local filesystem)--> storage/uploads/
                              +--(local filesystem)--> knowledge-base/*.md
                              +--(OIDC)--> Microsoft Entra ID (single tenant)
```

Everything left of the Next.js server is untrusted input, including
authenticated users acting outside their granted role/department.

## STRIDE

### Spoofing

- **Threat**: forging tenant/role claims to impersonate a privileged user.
- **Mitigation**: Entra `tid` claim re-validated against `ENTRA_TENANT_ID`
  server-side (`isTenantClaimValid`); roles/departments are re-read from the
  database per request, never trusted from the session/JWT.
- **Residual risk**: a compromised `AUTH_SECRET` would let an attacker forge
  session cookies. Mitigation: secret is never committed, rotate on
  suspected compromise.

### Tampering

- **Threat**: a customer edits a hidden form field to submit a ticket as
  another user, or to another department without going through triage.
- **Mitigation**: submitter identity is taken from the server-side session,
  never from client input; every ticket-service function re-validates the
  actor's role/department against the ticket's _current_ department.
- **Threat**: a department agent modifies another department's ticket via
  API by guessing/enumerating a UUID.
- **Mitigation**: `canViewTicket`/department-scoped policies enforced on
  every read and write in the service layer (Section: broken access
  control / IDOR).

### Repudiation

- **Threat**: a staff member denies having triaged/resolved/transferred a
  ticket.
- **Mitigation**: append-only `AuditEvent` rows for role changes, triage,
  assignment, status changes, transfers, knowledge outcomes, and article
  publication, each with actor, timestamp, previous/new value.

### Information disclosure

- **Threat**: a customer reads another customer's ticket or internal notes.
- **Mitigation**: `canViewTicket`/`canViewInternalNotes` gate every read;
  customers are structurally excluded from the `InternalNote` table query
  path (separate table, not a visibility flag).
- **Threat**: Accounting Services/Legal ticket content leaks through search,
  logs, or analytics available to unrelated staff.
- **Mitigation**: department scoping applies uniformly; audit log redacts
  sensitive-looking fields; full ticket descriptions are not logged by
  default.
- **Threat**: an uploaded file's real content differs from its declared
  type, used to smuggle an HTML/SVG payload that gets rendered inline.
- **Mitigation**: magic-byte detection + blocked-extension list + no inline
  rendering of any upload; `Content-Disposition: attachment` for
  non-image/PDF types.

### Denial of service

- **Threat**: a single user floods ticket creation, chat, or upload
  endpoints.
- **Mitigation**: per-user rate limiting on ticket creation, messaging,
  uploads, knowledge search, and chat (documented single-instance
  limitation -- see SECURITY.md).
- **Out of scope for this prototype**: distributed/volumetric DoS
  protection (would sit in front of the app, e.g. a WAF/CDN in production).

### Elevation of privilege

- **Threat**: a customer calls a staff-only API route directly (bypassing
  the UI, which only _hides_ buttons it can't show).
- **Mitigation**: every mutation route re-derives authorization from
  `requireAuthContext()` + the RBAC policy layer; the UI's conditional
  rendering is a convenience, not a control.
- **Threat**: a Department Agent grants themselves the Administrator role.
- **Mitigation**: role assignment (`/admin/users`, `setUserRole`) requires
  `canAdminister`, checked server-side on every call.

## Explicitly out of scope for this pass

- Physical/host security of the machine running Docker
- Supply-chain compromise of a transitive npm dependency's publish process
  (mitigated only by SCA scanning catching _known_ vulnerabilities, not
  zero-days)
- Insider threat from someone with direct Postgres access outside the app
