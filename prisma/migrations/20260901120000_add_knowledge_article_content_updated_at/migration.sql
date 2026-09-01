-- AlterTable
-- contentUpdatedAt tracks actual content changes (create, or a
-- contentHash change on kb:reindex sync), separate from `updatedAt`
-- which is bumped on every article view. Backfilled from the existing
-- `updatedAt` value as the best available approximation for rows that
-- predate this column.
ALTER TABLE "KnowledgeArticle" ADD COLUMN "contentUpdatedAt" TIMESTAMP(3);

UPDATE "KnowledgeArticle" SET "contentUpdatedAt" = "updatedAt";

ALTER TABLE "KnowledgeArticle" ALTER COLUMN "contentUpdatedAt" SET NOT NULL;
ALTER TABLE "KnowledgeArticle" ALTER COLUMN "contentUpdatedAt" SET DEFAULT CURRENT_TIMESTAMP;
