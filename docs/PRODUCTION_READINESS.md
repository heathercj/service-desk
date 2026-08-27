# Production-readiness checklist

This prototype is architected for production hardening, not deployed to it.
Track these items before any real deployment.

## Business decisions required before any test instance

Surfaced by a five-perspective readiness review (business, engineering,
database, performance, security) on 2026-08-26, commit `7bd0873`. These are
not code changes -- no amount of engineering work resolves them, and
everything else in this document sequences off them.

- [ ] **Name an application owner, a data owner, and a support contact.**
      Nothing in this repo or its docs names who is accountable once real
      people depend on this -- who gets contacted if it breaks, who approves
      changes, who owns the data in it.
- [ ] **Decide who the test users are.** The seeded roles (`CUSTOMER`,
      `TRIAGE_AGENT`, `DEPARTMENT_AGENT`, `DEPARTMENT_MANAGER`,
      `KNOWLEDGE_MANAGER`, `ADMINISTRATOR`) and single-tenant Entra ID auth
      suggest internal-only, but nothing states whether "Customer" means an
      external party or an Alair Homes employee. This changes the data-
      classification answer below.
- [ ] **Decide real vs. synthetic data for the test round**, given the app
      may hold ticket text, screenshots, and employee PII (see
      `THREAT_MODEL.md` "Assets"). Do not default to "it's just a test."
- [ ] **Ratify or override the recommendation to fix email + object storage
      before onboarding testers** (see below), rather than leaving it
      implicit.

## Must fix before production

- [ ] **Remaining `pnpm audit` findings** (13, incl. 1 critical / 4 high as
      of this build) are all in dependencies vendored inside `next@15.5.21`
      itself or in dev-only Vite/Vitest tooling -- see SECURITY.md
      "Dependency scan status". Re-check after each Next.js upgrade.

- [ ] **Malware scanning**: replace `LocalHeuristicScanProvider`
      (`src/lib/storage/malware-scan.ts`) with a real AV engine (ClamAV
      sidecar, Microsoft Defender for Storage, cloud AV API).
- [ ] **Email delivery**: implement a real `EmailProvider` (Microsoft Graph
      `sendMail` or Azure Communication Services) and a secure inbound-reply
      architecture; `ConsoleEmailProvider` must never run in production.
- [ ] **Rate limiting**: replace the in-memory limiter
      (`src/lib/http/rate-limit.ts`) with a shared store (Redis) if running
      more than one instance.
- [ ] **Confirm the proxy sets `x-forwarded-for`** before trusting the sign-in
      limit. `src/middleware.ts` keys that bucket on the header and falls back
      to the single key `auth:unknown` when it is absent -- so behind a proxy
      that does not set it, every user in the organisation shares one budget of
      `RATE_LIMIT_AUTH_MAX` sign-ins a minute, and one person fumbling their
      password locks out everyone. Fails closed, which is the right direction
      for a security control and an availability risk worth knowing about. It
      is how the e2e suite used to lock itself out -- see "The flake that was
      not about `next dev`" in TESTING.md. Note also that the header is
      client-supplied: whatever terminates TLS must overwrite it, not append
      to it, or the limit is trivially evaded by spoofing.
- [ ] **Object storage**: implement an Azure Blob Storage
      `ObjectStorageProvider` if not deploying with a persistent local disk;
      keep downloads proxied through the authorized route rather than
      issuing direct/public blob URLs.
- [ ] **GitHub Actions**: pin to full commit SHAs (currently version tags --
      see SECURITY.md for why).
- [ ] **Secrets**: real `AUTH_SECRET`, `ENTRA_CLIENT_SECRET`, and
      `DATABASE_URL` credentials in a secret manager, never in `.env` files
      committed anywhere. Rotate `AUTH_SECRET` on any suspected compromise
      (invalidates all sessions).
- [ ] **HTTPS everywhere** with HSTS (already emitted in production mode by
      `next.config.ts`, but verify the actual TLS termination point).
- [ ] **Backups**: configure real Postgres backup/restore (see below) and
      test a restore, not just a backup job succeeding.

## Should fix / revisit

- [ ] **No database connection-pool limit is set anywhere** (`src/lib/db.ts`
      constructs a bare `new PrismaClient()`; `.env.example`'s
      `DATABASE_URL` has no `connection_limit`). Prisma's default pool size
      is computed per-process and unbounded across instances -- set
      `connection_limit`/`pool_timeout` explicitly on `DATABASE_URL`, sized
      against the target database's `max_connections`, before pointing at a
      shared hosted instance.
- [ ] **`pnpm db:reset`'s safety guard is a fragile substring match**, not a
      real safeguard (`scripts/db-reset.ts`): it only refuses to run against
      `NODE_ENV=production` or a URL containing `localhost`/`127.0.0.1`/
      `postgres:5432`. A hosted test database's connection string won't
      match any of those, so the guard silently doesn't apply. Harden it
      (e.g. an explicit `ALLOW_DB_RESET=true` opt-in, or a hostname
      allowlist) before more than one machine has a `.env` pointing at a
      shared database.
- [ ] **No route tests exist for admin authorization boundaries**
      (`/api/admin/departments/**`, `/api/admin/users/[userId]/role`),
      despite every other route family being tested per the project's own
      convention. A regression in the 401/403/400 boundary on these routes
      wouldn't be caught by CI.
- [ ] **Coverage percentage is misleading, not just low.**
      `vitest.config.ts` excludes `*.integration.test.ts` from coverage
      with no include-scoping, so `ticket-service.ts` (1,100+ lines of core
      logic) reports 0% despite being covered by integration tests. Scope
      the coverage config to reflect what's actually tested before using
      the number to prioritize future test-writing effort.
- [ ] **Confirm the SAST/DAST/secret/dependency-scan CI workflows are
      required branch-protection checks**, not just workflows that run.
      They currently gate nothing if a merge can bypass a red check.

- [ ] `createDraftArticle` has no collision handling if two articles slugify
      to the same `(department, slug)`/`filePath` (e.g. two workers drafting
      similarly-titled articles same-day) -- currently bubbles up as a raw
      database unique-constraint error instead of a friendly "an article
      with this title already exists, try a more specific title" message.

- [ ] The production build emits a benign warning that `jose` (a
      transitive dependency of Auth.js, used for JWT handling) references
      a Node.js API not supported in the Edge Runtime, because
      `middleware.ts` imports `src/auth.ts` directly. This doesn't fail the
      build and doesn't affect normal sign-in (no compressed JWTs are used
      by default), but the cleaner fix is splitting middleware-safe auth
      config out per Auth.js's own recommended pattern for Edge middleware.

- [ ] CSRF: add explicit double-submit token middleware for the JSON API
      routes if the deployment topology introduces any cross-origin
      posting surface beyond same-site cookies.
- [ ] Add server-side pagination cursors instead of offset-based pagination
      once ticket/article volume is large.
- [ ] Add a real embedding-based `AIProvider`/`KnowledgeSearchProvider`
      behind a feature flag, with explicit user-facing disclosure before
      any ticket/article text leaves the app (Section 6).
- [ ] Externalize the department-suggestion keyword list
      (`src/lib/tickets/department-suggestion.ts`) into `AppSetting` so
      Administrators can tune it without a code change.
- [ ] Add image thumbnail generation for attachment previews. `sharp` is
      pinned as a direct dependency at a patched version (it's also pulled
      in transitively by Next.js's optional image-optimization feature,
      which this app doesn't use) but is not wired into an upload-time
      thumbnail step yet.
- [ ] Strip EXIF/image metadata from uploaded images (documented limitation
      -- not yet implemented).
- [ ] Restore-to-previous-status for archived knowledge articles instead of
      always restoring to `PUBLISHED`.

## Explicitly out of scope for this prototype (by design, not oversight)

- Real inbound email processing (would need a genuinely secure
  webhook/mailbox-polling design, not a shortcut)
- SSRF-style server-side fetching/previewing of user-submitted ticket URLs
  (deliberately never implemented -- see THREAT_MODEL.md)
- Horizontal scaling / multi-instance deployment topology

## Backup and restore guidance (prototype data)

**Backup** (local Docker Compose Postgres):

```bash
docker compose exec postgres pg_dump -U service_desk service_desk > backup.sql
```

**Restore**:

```bash
docker compose exec -T postgres psql -U service_desk service_desk < backup.sql
```

Knowledge article content is already backed up by git (it's a normal
tracked directory) -- only the database and `storage/uploads/` (gitignored,
local-only) need this kind of backup for the prototype. A production
deployment needs a real managed-Postgres backup policy (point-in-time
recovery) and equivalent durable storage for uploads (e.g. Azure Blob
Storage with redundancy), not ad hoc `pg_dump`.

## Definition-of-done cross-check

See the final response in the session that built this repository for the
full "what was built / commands run / test results / security scan
results" report. This document is the durable, versioned record of what
still needs to happen before a real deployment; that report is a point-in-
time snapshot.
