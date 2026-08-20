-- Idempotent knowledge-base full-text + trigram search setup (Section 11).
-- Safe to run repeatedly (used by `pnpm db:migrate` and `pnpm db:reset`).
-- See docs/ARCHITECTURE.md "Knowledge search" for why this lives outside
-- Prisma's migration DSL.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "KnowledgeArticle" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE OR REPLACE FUNCTION compute_knowledge_article_tsvector(p_article_id text)
RETURNS tsvector AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(ka.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(ka.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(string_agg(t.name, ' '), '')), 'C')
  FROM "KnowledgeArticle" ka
  LEFT JOIN "KnowledgeArticleTag" kat ON kat."articleId" = ka.id
  LEFT JOIN "Tag" t ON t.id = kat."tagId"
  WHERE ka.id = p_article_id
  GROUP BY ka.id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION knowledge_article_refresh_search_vector()
RETURNS trigger AS $$
BEGIN
  UPDATE "KnowledgeArticle"
  SET "searchVector" = compute_knowledge_article_tsvector(NEW.id)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_article_search_vector ON "KnowledgeArticle";
CREATE TRIGGER trg_knowledge_article_search_vector
  AFTER INSERT OR UPDATE OF title, summary ON "KnowledgeArticle"
  FOR EACH ROW EXECUTE FUNCTION knowledge_article_refresh_search_vector();

CREATE OR REPLACE FUNCTION knowledge_article_tag_refresh_search_vector()
RETURNS trigger AS $$
DECLARE
  target_id text;
BEGIN
  target_id := COALESCE(NEW."articleId", OLD."articleId");
  UPDATE "KnowledgeArticle"
  SET "searchVector" = compute_knowledge_article_tsvector(target_id)
  WHERE id = target_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_article_tag_search_vector ON "KnowledgeArticleTag";
CREATE TRIGGER trg_knowledge_article_tag_search_vector
  AFTER INSERT OR DELETE ON "KnowledgeArticleTag"
  FOR EACH ROW EXECUTE FUNCTION knowledge_article_tag_refresh_search_vector();

-- Backfill any existing rows (no-op on an empty table).
UPDATE "KnowledgeArticle" ka
SET "searchVector" = compute_knowledge_article_tsvector(ka.id);

CREATE INDEX IF NOT EXISTS knowledge_article_search_vector_idx
  ON "KnowledgeArticle" USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS knowledge_article_title_trgm_idx
  ON "KnowledgeArticle" USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_article_summary_trgm_idx
  ON "KnowledgeArticle" USING GIN (summary gin_trgm_ops);
