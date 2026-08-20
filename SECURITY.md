# Security

## Reporting a vulnerability

This is an internal prototype. Report suspected vulnerabilities directly to
the Product Team / repository maintainers rather than opening a public
issue. Include: affected route/file, reproduction steps, and impact.
Do not include real credentials or real ticket data in a report.

## What this prototype does

- **Authentication**: Microsoft Entra ID via Auth.js, single tenant only
  (issuer is `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/v2.0`, not
  `common`/`organizations`/`consumers`). Every sign-in's `tid` claim is
  re-checked against `ENTRA_TENANT_ID` even though the issuer is already
  tenant-scoped (`src/auth.ts`, `src/lib/auth/tenant-validation.ts`).
- **Authorization**: server-enforced RBAC + department scoping. Roles and
  department memberships are re-read from the database on every request
  (`src/lib/auth/session.ts`) -- never trusted from a JWT/session claim.
  Policy functions (`src/lib/rbac/policies.ts`) are pure and unit tested.
- **Development authentication**: gated by `ENABLE_DEV_AUTH=true`, refuses
  to load (throws at server start, not just a warning) when
  `NODE_ENV=production` (`src/lib/env.ts`). Only accepts the fixed set of
  seeded identities in `src/lib/dev-auth/dev-identities.ts` -- it never
  creates a new identity on sign-in, so it can't be used to conjure an
  arbitrary privileged account.
- **SSRF**: submitted ticket URLs are never fetched/previewed server-side.
  They're validated (scheme/host/length), stored, and rendered only as an
  inert link with the destination hostname shown (`src/lib/validation/url-safety.ts`,
  `src/components/safe-external-link.tsx`).
- **File uploads**: content-type is detected from magic bytes
  (`file-type` package), not trusted from the filename or browser MIME
  type. Stored filenames are randomized. SVG/HTML are never accepted, so
  nothing uploaded is ever rendered inline as markup
  (`src/lib/storage/attachment-policy.ts`). Files are asynchronously
  "scanned" by a prototype heuristic and are not downloadable until marked
  `clean` (`src/lib/storage/malware-scan.ts`, `attachment-service.ts`).
- **Path traversal**: knowledge-base article paths are derived only from a
  validated department key + a regex-constrained slug, and the resolved
  path is re-verified to stay under `knowledge-base/` before any read/write
  (`src/lib/knowledge/markdown-repo.ts`).
- **Markdown rendering**: `rehype-sanitize` strips raw HTML from every
  rendered article; nothing uses `dangerouslySetInnerHTML`.
- **SQL injection**: all database access goes through Prisma's parameterized
  query builder; the few raw queries (`$queryRaw` for full-text/trigram
  search) use tagged-template parameterization, never string concatenation.
- **Email header injection**: `src/lib/email/sanitize.ts` rejects CR/LF in
  any value that becomes a header and strips control characters from the
  body.
- **Audit log**: append-only from the application's perspective (no
  update/delete call exists in the codebase), with automatic redaction of
  keys matching `password|secret|token|authorization|api[-_ ]?key|ssn|credit[-_ ]?card`
  before anything is written (`src/lib/audit/audit-log.ts`).
- **Rate limiting**: applied to ticket creation, messaging, attachment
  upload, knowledge search, chat, and sign-in (`src/lib/http/rate-limit.ts`,
  `src/middleware.ts`). In-memory / single-process only -- see limitation
  below.
- **Security headers**: CSP, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS
  in production (`next.config.ts`).
- **Errors**: the global error boundary (`src/app/error.tsx`) never renders
  `error.message` to the client; unhandled route errors return a generic
  message (`src/lib/http/route-helpers.ts`) while the real error is logged
  server-side.

## Dependency scan status (as of this build)

`pnpm audit` was run and acted on directly: direct dependencies were bumped
to patched versions (`next` 15.1.4 -> 15.5.21, `next-auth` beta.25 ->
beta.32, `postcss` -> 8.5.23, `file-type` -> 21.3.1, `playwright` -> 1.55.1,
`vitest` -> 2.1.9), which took the finding count from **59 (7 critical, 20
high)** down to **13 (1 critical, 4 high)**. The remaining findings are all
in dependencies vendored _inside_ `next@15.5.21` itself (its own nested,
older `postcss`/`sharp` copies used by its build tooling/image-optimization
feature -- which this app doesn't use) or in Vitest/Vite dev-only tooling
(exploitable only if someone runs `vitest --ui`, which no script here
does). These aren't fixable by bumping this project's own `package.json`
pins; re-run `pnpm audit` after a future Next.js patch release and re-check
docs/PRODUCTION_READINESS.md before any production deployment.

## Known limitations (see docs/PRODUCTION_READINESS.md for the full list)

- **Rate limiting is per-process, in-memory.** It does not coordinate
  across multiple server instances. Production needs a shared store (e.g.
  Redis) behind the same `checkRateLimit()` signature.
- **Malware scanning is a heuristic stand-in**, not a real antivirus engine.
  Do not deploy to production without replacing
  `src/lib/storage/malware-scan.ts`.
- **Email is captured locally, never delivered.** No real SMTP/Graph/ACS
  integration exists yet.
- **GitHub Actions are pinned to version tags, not commit SHAs**, since
  guessing a wrong SHA from memory would be worse than a well-known tag.
  Pin to SHAs before this becomes a production CI pipeline (Dependabot can
  propose the exact SHA for a tag it already tracks).
- **CSRF**: relies on Auth.js's built-in same-site session cookie handling;
  no additional double-submit CSRF token middleware has been added for the
  custom JSON API routes. State-changing routes require an authenticated
  session and are not reachable cross-origin without one.

## Free/OSS security tooling in this repo

See `.github/workflows/`: `semgrep.yml` (SAST), `sca.yml` (OSV-Scanner +
`pnpm audit` + CycloneDX SBOM), `gitleaks.yml` (secret scanning),
`trivy.yml` (filesystem/config/image scanning), `dast.yml` (OWASP ZAP
baseline against a locally-launched, dev-auth-enabled build). None of these
upload source code, ticket fixtures, or secrets to a third-party cloud
service by default (Semgrep App/Cloud sync is not configured; ZAP runs
fully within the CI runner against localhost).
