# Architecture

## System overview

A single Next.js App Router application (no separate backend service) with
PostgreSQL for structured data and version-controlled Markdown files for
knowledge-article content. Every server-side data access goes through a
service layer under `src/lib/` -- pages and API routes are thin.

```
Browser
  |
  v
Next.js (App Router)
  ├─ middleware.ts ............. default-deny auth gate + login rate limit
  ├─ src/app/**/page.tsx ....... Server Components (read paths)
  ├─ src/app/api/**/route.ts ... API routes (mutations), Zod-validated
  └─ src/auth.ts ............... Auth.js: Entra ID + optional dev Credentials
       |
       v
  src/lib/  (the actual product)
  ├─ auth/session.ts .......... re-reads roles/departments from DB every call
  ├─ rbac/policies.ts .......... pure, unit-tested authorization functions
  ├─ tickets/ .................. state machine + ticket service (transactions)
  ├─ knowledge/ ................ markdown repo, search, resolution gate
  ├─ email/, ai/, storage/ ..... provider interfaces + local implementations
  └─ audit/ .................... append-only, redacted audit log
       |
       v
  PostgreSQL (Prisma)  +  knowledge-base/*.md (git-tracked)  +  storage/uploads/ (local disk)
```

## Why these choices

### Server-enforced RBAC, re-checked every request

`getAuthContext()` (`src/lib/auth/session.ts`) reads the session's immutable
identifiers (internal user ID, Entra object/tenant ID) and then queries the
database for _current_ roles and department memberships on every call. The
session/JWT itself never carries roles. This means a role revoked in
`/admin/users` takes effect on the user's very next request, not at their
next login -- and it means there's no way for a modified client request to
smuggle in a stale or forged role claim. See ADR 0002.

### One ticket-service, one state machine, both centralized

`src/lib/tickets/state-machine.ts` is the single source of truth for which
status transitions exist and which roles may perform them.
`src/lib/tickets/ticket-service.ts` is the only place that calls
`ticket.update()` with a new `status`. No page or API route sets status
directly. This is what makes "reject invalid transitions on the server"
actually true rather than aspirational, and it's why the state machine has
its own dedicated unit tests independent of any database.

### Markdown-in-git + Postgres index, not Markdown-in-database

Knowledge articles are Markdown files under `knowledge-base/<department>/`
with YAML front matter, giving them normal git history/PR review/diffing.
PostgreSQL holds a synchronized metadata + full-text-search index
(`KnowledgeArticle` table + a `tsvector` column maintained by a Postgres
trigger -- see `scripts/db-search-setup.sql`). `pnpm kb:reindex` re-syncs the
database from disk; `pnpm kb:validate` fails CI on front-matter/slug/ID
problems. See ADR 0004.

### Local-first provider interfaces

`EmailProvider`, `ObjectStorageProvider`, `AIProvider`/`KnowledgeSearchProvider`,
and `MalwareScanProvider` are small interfaces with exactly one
implementation each right now, all fully local/free. Swapping in Microsoft
Graph mail, Azure Blob Storage, an embedding-based search provider, or a
real AV engine means implementing the interface, not rewriting callers. See
ADR 0003 (AI provider) and ADR 0005 (email/storage).

### Resolution gate as its own pure module

`src/lib/knowledge/resolution-gate.ts` takes plain facts (do we have a
summary/steps, is the knowledge check current, is there a valid outcome)
and returns pass/fail + reasons. The ticket service supplies those facts
from the database; the gate itself has no database dependency, so its rules
are unit tested directly. See ADR 0006.

## Knowledge search

Postgres `tsvector` (title/summary/tags, weighted A/B/C) combined with
`pg_trgm` trigram similarity on title/summary, blended into one ranking
score (`src/lib/knowledge/search.ts`). This is deliberately NOT managed
through Prisma's migration DSL -- Prisma's `Unsupported("tsvector")` type
exists for schema visibility, but the actual generated column, trigger, and
indexes are idempotent raw SQL (`scripts/db-search-setup.sql`), applied via
`pnpm db:search:setup` (chained after every `prisma migrate dev|deploy`).
This is the same approach Prisma's own documentation recommends for
full-text search, since Prisma has no first-class support for
trigger-maintained generated columns.

## Email integration (what remains for production)

`ConsoleEmailProvider` persists an `OutboundEmail` row with
`status: CAPTURED_DEV` and never calls a real mail API. To go to production:

1. Implement `EmailProvider` against Microsoft Graph `sendMail` (delegated,
   least-privilege `Mail.Send`) or Azure Communication Services Email.
2. Add real delivery-status webhooks/polling to move `OutboundEmail.status`
   through `queued -> sent | failed`.
3. Design and secure an **inbound** reply architecture (e.g. Graph
   subscriptions + a validated webhook, or a dedicated mailbox polling
   worker) -- this prototype deliberately does not fake inbound processing,
   since a fake implementation would be actively misleading about a real
   integration point.

## Malware scanning (what remains for production)

`LocalHeuristicScanProvider` recognizes an EICAR-style test string and
otherwise marks everything `clean`. Replace with a real scanner (ClamAV
sidecar, Microsoft Defender for Storage, or a cloud AV API) behind the same
`MalwareScanProvider` interface before handling real user uploads.

## Object storage (what remains for production)

`LocalObjectStorageProvider` writes to `storage/uploads/` outside
`public/`. A production `AzureBlobStorageProvider` would implement the same
`write/read/delete/exists` interface against a private container, with
downloads still proxied through the app's authorized, opaque
`/api/attachments/[id]/download` route rather than issuing direct blob URLs
(unless using short-lived SAS tokens with equivalent authorization checks).

## Data model

See `prisma/schema.prisma` for the full model and `docs/PERMISSIONS.md` /
`docs/TICKET_LIFECYCLE.md` / `docs/KNOWLEDGE_LIFECYCLE.md` for the
role/permission matrix, state diagram, and knowledge lifecycle.
