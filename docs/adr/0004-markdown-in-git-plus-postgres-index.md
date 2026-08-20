# ADR 0004: Markdown-in-git for article content, Postgres for the search index

## Status

Accepted

## Context

Section 11 requires knowledge articles as version-controlled Markdown files
with validated front matter, plus a database index for metadata and
searchable content, plus a CI-enforced content check.

## Decision

Article body + front matter live at `knowledge-base/<department>/<slug>.md`
(git is the revision history). `KnowledgeArticle` in Postgres mirrors the
front matter fields plus a `tsvector` search column maintained by a
Postgres trigger (`scripts/db-search-setup.sql`), kept in sync by
`pnpm kb:reindex`. `pnpm kb:validate` parses every file against
`front-matter-schema.ts` and fails on invalid front matter, duplicate IDs,
duplicate slugs within a department, unsafe links, or malformed Markdown --
wired into CI.

## Consequences

- Article history/diffing/PR review comes for free from git; no separate
  "revision" UI was needed beyond the `KnowledgeArticleRevision` table,
  which exists for database-side audit continuity.
- The database and filesystem can drift if someone edits a `.md` file by
  hand without running `kb:reindex`, or edits the database without writing
  the file. `createDraftArticle`/`publishArticle`/etc. always write both
  together to avoid this in the normal app flow; hand-editing is the one
  path that needs the explicit reindex step.
- Full-text search requires Postgres `pg_trgm` + the trigger-maintained
  column, managed by raw SQL rather than Prisma's migration DSL (see
  ARCHITECTURE.md "Knowledge search").
