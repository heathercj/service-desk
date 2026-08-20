-- Enables trigram similarity used by the knowledge-base similarity search
-- (Section 11) in addition to Postgres full-text search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
