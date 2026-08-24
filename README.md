# Service Desk (prototype)

An internal service-desk ticket management platform for one Microsoft Entra ID
tenant: a customer portal, a triage portal, and department worker portals,
backed by a first-class Markdown knowledge base with a resolution gate that
requires every resolved ticket to leave behind (or deliberately decline)
reusable knowledge.

This is a **prototype**. It is architected, modeled, and tested with a clean
path to production hardening, but several integrations are intentionally
mocked/local-only -- see [Implemented vs. mocked](#implemented-vs-mocked-vs-future)
and [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Contents

- [Prerequisites](#prerequisites)
- [Quick start (development authentication)](#quick-start-development-authentication)
- [Configuring real Microsoft Entra ID authentication](#configuring-real-microsoft-entra-id-authentication)
- [All commands](#all-commands)
- [Implemented vs. mocked vs. future](#implemented-vs-mocked-vs-future)
- [Architecture decisions](#architecture-decisions)
- [Repository layout](#repository-layout)

## Prerequisites

| Tool       | Version                                                       |
| ---------- | ------------------------------------------------------------- |
| Node.js    | 22.17.0 (`.nvmrc`)                                            |
| pnpm       | 9.15.4                                                        |
| Docker     | any current release, Compose v2                               |
| PostgreSQL | 16.6-alpine, supplied by Docker Compose -- nothing to install |

Full checklist, including the end-to-end browser build and the optional
security tooling: **[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)**.

Run `pnpm preflight` at any point to check a machine against this list; it
prints the fix command for anything missing.

## Quick start (development authentication)

This gets the app running locally with seeded demo identities and no Entra
app registration required.

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open <http://localhost:3000>. You'll land on `/login`, which -- because
`.env` ships with `ENABLE_DEV_AUTH=true` -- shows a **development sign-in**
panel in addition to the Microsoft button. Pick any seeded identity:

| Identity       | Roles                                | Notes                            |
| -------------- | ------------------------------------ | -------------------------------- |
| Casey Customer | Customer                             | Submits/tracks tickets           |
| Taylor Triage  | Triage Agent                         | Triage queue and routing         |
| Alex Agent     | Department Agent                     | Technology Support               |
| Morgan Manager | Department Manager, Department Agent | Technology Support + Training    |
| Kai Knowledge  | Knowledge Manager                    | Publish/archive articles         |
| Robin Admin    | Administrator                        | Users, roles, departments, audit |

While `ENABLE_DEV_AUTH=true` the login page carries a warning-bordered
**Development sign-in** card naming the flag; there is deliberately no
site-wide banner on top of that, because the build it would warn about cannot
start (see below).
Seed data (`prisma/seed.ts`) walks every ticket status and includes several
knowledge articles (published, draft, and archived) so every major workflow
has something to look at immediately.

**The app refuses to start with `ENABLE_DEV_AUTH=true` when `NODE_ENV=production`** --
this is enforced in `src/lib/env.ts` and is verified in
`src/lib/env.ts`'s startup check (see [SECURITY.md](SECURITY.md)).

## Configuring real Microsoft Entra ID authentication

Full app-registration walkthrough: [docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md).
Summary:

1. Register an app in **your** Entra tenant (not a multi-tenant app).
2. Redirect URI: `http://localhost:3000/api/auth/callback/microsoft-entra-id` (dev)
   or `https://<your-domain>/api/auth/callback/microsoft-entra-id` (prod).
3. Create a client secret.
4. Set in `.env`:
   ```bash
   ENTRA_TENANT_ID="<your tenant GUID>"
   ENTRA_CLIENT_ID="<app registration client ID>"
   ENTRA_CLIENT_SECRET="<client secret value>"
   ENABLE_DEV_AUTH=false
   ```
5. Restart the app. The Microsoft sign-in button will authenticate against
   your tenant; guest/partner accounts in that tenant work automatically.
   Any identity whose `tid` claim doesn't match `ENTRA_TENANT_ID` is rejected
   even though the issuer URL is already tenant-scoped (defence in depth).

## All commands

```bash
# Check this machine has the right versions of everything
pnpm preflight

# Install
pnpm install

# Environment
cp .env.example .env        # then edit as needed

# Database (requires Docker Desktop running)
docker compose up -d
pnpm db:migrate              # prisma migrate dev + knowledge-base search setup
pnpm db:seed
pnpm db:reset                # DESTRUCTIVE local-only reset+reseed; refuses if NODE_ENV=production
                              #   or DATABASE_URL doesn't look like localhost

# Run the app
pnpm dev                     # http://localhost:3000, ENABLE_DEV_AUTH from .env
pnpm build                   # production build (fails if ENABLE_DEV_AUTH=true + NODE_ENV=production
                              #   at actual server START; the build step itself is exempt, see
                              #   src/lib/env.ts, so CI can still build an image that is later
                              #   started with dev auth for the DAST job)
pnpm start                   # requires `output: standalone` -- use `node .next/standalone/server.js`

# Quality gates
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                    # Vitest unit + integration tests (integration tests need Postgres, see below)
pnpm exec playwright install --with-deps chromium   # one-time browser install
pnpm test:e2e                # Playwright end-to-end tests (needs the app running + seeded)
pnpm ci:local                 # format:check && lint && typecheck && test && build

# Knowledge base
pnpm kb:validate              # fails on invalid front matter / duplicate IDs or slugs / unsafe links
pnpm kb:reindex               # re-syncs DB metadata from knowledge-base/*.md

# Security (see SECURITY.md for tool installation)
pnpm security                 # secrets + sca + sast + container
pnpm security:sast            # Semgrep (requires `pipx install semgrep` or similar)
pnpm security:sca              # OSV-Scanner (requires the osv-scanner binary) + pnpm audit
pnpm security:secrets          # Gitleaks (requires the gitleaks binary)
pnpm security:dast             # OWASP ZAP baseline via Docker, against a locally running app
pnpm security:container        # Trivy (requires the trivy binary)
```

### Running integration tests against Postgres

Vitest integration tests (`src/**/*.integration.test.ts`) exercise the real
Prisma-backed service layer and need a live database:

```bash
docker compose up -d
DATABASE_URL="postgresql://service_desk:service_desk_dev_password@localhost:5432/service_desk_test?schema=public" \
  pnpm exec prisma migrate deploy
pnpm test
```

### Resetting prototype data safely

`pnpm db:reset` refuses to run if `NODE_ENV=production`, or if `DATABASE_URL`
doesn't look like a local development database (see `scripts/db-reset.ts`).
It is never wired into any deploy path.

## Implemented vs. mocked vs. future

**Fully implemented, real, working:**

- Entra ID (Auth.js) authentication with tenant-claim validation, plus an
  isolated, seed-only development-auth mode
- Server-enforced RBAC + department scoping (re-checked from the database on
  every request, never trusted from a session claim)
- Full ticket lifecycle state machine with role-gated transitions, reason
  requirements, and optimistic concurrency
- Customer, triage, and department portals against the same authorization
  layer
- Markdown knowledge base with validated front matter, Postgres full-text +
  trigram similarity search, and a resolution gate that blocks `Resolved`
  without a current knowledge outcome
- Local object storage with magic-byte content detection, randomized
  filenames, and opaque authorized-download routes
- Append-only audit log with redaction
- SAST/SCA/DAST/secret-scanning/SBOM/container-scanning CI, all free/OSS

**Mocked / local-only by design (see docs/PRODUCTION_READINESS.md for the
production equivalent):**

- **Email**: `ConsoleEmailProvider` persists an `OutboundEmail` row and shows
  it on `/dev-mailbox`. Nothing is ever actually delivered.
- **Malware scanning**: a heuristic stand-in (`LocalHeuristicScanProvider`)
  that recognizes an EICAR-style test string and otherwise marks files
  `clean`. **A real deployment must replace this with an actual scanner.**
- **AI / semantic similarity**: `LocalAIProvider` uses only Postgres
  full-text + trigram search -- no external API, no API key, works offline.
- **Object storage**: local filesystem (`storage/uploads/`, gitignored).
  Interface is ready for an Azure Blob Storage provider.

**Explicitly out of scope for this prototype pass** (see
docs/PRODUCTION_READINESS.md "Known limitations" for the full list):

- Real inbound email processing
- CSRF token middleware beyond Auth.js's built-in same-site cookie protection
- Rate limiting is implemented as an in-memory token bucket (documented as
  single-instance-only; production needs a shared store such as Redis)

## Architecture decisions

See [docs/adr/](docs/adr/) for the numbered ADRs, and
[ARCHITECTURE.md](ARCHITECTURE.md) for the system-level narrative.

## Repository layout

```
src/app/                 Next.js App Router routes (pages + API routes)
src/lib/                 Service layer: auth, rbac, tickets, knowledge, email,
                         storage, ai, audit, validation -- this is where the
                         actual business rules and authorization live
src/components/          Shared UI (shadcn-style primitives + app components)
prisma/                  schema.prisma, seed.ts, migrations
knowledge-base/          Markdown knowledge articles (version-controlled)
scripts/                 Local dev/CI scripts (db reset, kb validate/reindex,
                         DAST runner, search-index setup)
e2e/                     Playwright end-to-end tests
docs/                    ADRs, Entra setup, permission matrix, lifecycle docs,
                         production-readiness checklist, API route catalogue
.github/workflows/       CI + security scanning workflows
```

Also see: [SECURITY.md](SECURITY.md), [THREAT_MODEL.md](THREAT_MODEL.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [docs/API.md](docs/API.md),
[docs/PERMISSIONS.md](docs/PERMISSIONS.md),
[docs/TICKET_LIFECYCLE.md](docs/TICKET_LIFECYCLE.md),
[docs/KNOWLEDGE_LIFECYCLE.md](docs/KNOWLEDGE_LIFECYCLE.md),
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).
