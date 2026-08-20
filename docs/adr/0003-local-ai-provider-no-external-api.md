# ADR 0003: Deterministic local search as the `AIProvider`, no external API by default

## Status

Accepted

## Context

Sections 2, 6, 11, and 12 require the knowledge-suggestion, chat-assistant,
and article-similarity features to work without any paid AI service or API
key, and require that ticket/article content never be sent to an external
AI provider without explicit configuration and disclosure.

## Decision

`LocalAIProvider` (`src/lib/ai/local-provider.ts`) and
`PostgresKnowledgeSearchProvider` (`src/lib/knowledge/similarity.ts`) both
wrap one shared core (`src/lib/knowledge/search.ts`): Postgres full-text
search (`tsvector`, weighted title/summary/tags) blended with `pg_trgm`
trigram similarity. No network call, no API key, deterministic and
therefore testable.

## Consequences

- Suggestion/search quality is bounded by keyword/trigram matching, not
  semantic understanding -- a real embedding model would do better on
  paraphrased queries.
- A future embedding-based provider can be added behind the same
  `AIProvider`/`KnowledgeSearchProvider` interfaces, gated by
  `AI_PROVIDER` and requiring explicit configuration + user-facing
  disclosure before any ticket/article text leaves the app, per Section 6.
- The chat assistant is retrieval-only and templated (no LLM), which also
  means there is no prompt-injection surface to defend against yet --
  documented as a requirement for whichever future LLM provider is added.
