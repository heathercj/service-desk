# ADR 0002: JWT sessions (no Auth.js database adapter); RBAC re-read from DB every request

## Status

Accepted

## Context

Section 3 requires: never trust roles/department/tenant info from the
browser, and validate authorization in the server-side service layer for
every read and write. Auth.js v5 requires the `jwt` session strategy
whenever a `Credentials` provider is configured (needed for the dev-auth
mode), which rules out database-backed sessions via `@auth/prisma-adapter`
for this app as configured.

## Decision

Use JWT sessions. The JWT/session carries only immutable identifiers
(internal user ID, Entra object ID, Entra tenant ID) -- never roles or
department memberships. `src/lib/auth/session.ts`'s `getAuthContext()`
queries the database for the user's _current_ roles and department
memberships on every call (React's `cache()` only de-duplicates repeats
within one request's render, never across requests).

## Consequences

- A role granted or revoked in `/admin/users` takes effect on the user's
  very next request, not at their next login.
- No `Account`/`Session`/`VerificationToken` tables are needed --
  `@auth/prisma-adapter` was dropped as a dependency.
- One extra database round-trip per request for auth context; acceptable at
  prototype scale, and a natural place to add a short-lived cache
  (per-request only, never cross-request) if it becomes a bottleneck.
