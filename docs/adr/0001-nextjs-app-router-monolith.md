# ADR 0001: Single Next.js App Router application, no separate backend

## Status

Accepted

## Context

The spec asks for three role-specific portals sharing one data model,
authentication boundary, and authorization layer, plus a knowledge base and
resolution gate that cut across all three. A separate frontend/backend
split would duplicate the authorization logic (once in an API server, once
in frontend route guards) or require a shared package, adding complexity
without a corresponding benefit at prototype scale.

## Decision

One Next.js (App Router) application. Server Components handle
authenticated reads directly against the service layer; API routes
(`src/app/api/**/route.ts`) handle mutations and are the only place
client components talk to the server. `src/lib/` is the actual product --
pages and routes are thin wrappers that call into it.

## Consequences

- Authorization is enforced once, in `src/lib/rbac` + the service layer,
  and reused by both Server Components and API routes.
- No API-shape duplication between "what the frontend needs" and "what a
  separate backend exposes."
- Scaling the read path and the write path independently (a common reason
  to split) is not available without further work -- acceptable for a
  prototype; documented in docs/PRODUCTION_READINESS.md.
