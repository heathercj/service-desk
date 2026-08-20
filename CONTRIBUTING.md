# Contributing

## Local setup

See [README.md](README.md#quick-start-development-authentication).

## Before opening a PR

```bash
pnpm ci:local
```

This runs `format:check`, `lint`, `typecheck`, `test`, and `build` -- the
same gates CI runs. Fix everything locally before pushing; CI additionally
runs the security scanners (Semgrep, OSV-Scanner, Gitleaks, Trivy, ZAP
baseline), which you can also run locally -- see [SECURITY.md](SECURITY.md).

## Code conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- All authorization decisions go through `src/lib/rbac/policies.ts`. Don't
  inline a role check in a page or route -- add or reuse a policy function
  so it stays unit-testable and consistent.
- All ticket status changes go through
  `src/lib/tickets/state-machine.ts` + `ticket-service.ts`. Never set
  `ticket.status` directly from a route handler.
- Server-only modules that are also imported by standalone scripts
  (`prisma/seed.ts`, `scripts/kb-*.ts`) must NOT `import "server-only"` --
  see the comment in `src/lib/knowledge/markdown-repo.ts`.
- New Zod schemas for form/API input live in `src/lib/validation/`, shared
  between client forms and server routes -- don't duplicate validation
  logic.
- New knowledge-base articles go under `knowledge-base/<department>/<slug>.md`
  with front matter matching `src/lib/knowledge/front-matter-schema.ts`. Run
  `pnpm kb:validate` before committing.

## Tests

- Unit tests are colocated as `*.test.ts` next to the module they cover
  (Vitest). Prefer testing the pure logic module (state machine, policies,
  resolution gate, validators) directly rather than mocking Prisma.
- Integration tests (`*.integration.test.ts`) exercise the real
  Prisma-backed service layer against a live Postgres -- see README for how
  to point them at a local database.
- End-to-end tests (`e2e/*.spec.ts`, Playwright) exercise full user
  journeys against a running, seeded app.

## Commit messages

Short, imperative, present tense ("Add department transfer audit event",
not "Added" or "Adding"). Reference the relevant spec section in the body
when it clarifies intent.

## Security-sensitive changes

If your change touches authentication, authorization, file uploads,
external URLs, or the audit log, call it out explicitly in the PR
description and re-read [THREAT_MODEL.md](THREAT_MODEL.md) for the
relevant section.
