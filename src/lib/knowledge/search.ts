import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Deterministic, no-API-key knowledge search core (Section 11, 12): blends
 * Postgres full-text ranking (title/summary/tags, weighted) with trigram
 * similarity so short or slightly-misspelled queries still surface
 * reasonable candidates. This is the "local fallback that requires no paid
 * AI service" required by Sections 2, 6, and 11 -- both `AIProvider`
 * (customer-facing suggestions, chat) and `KnowledgeSearchProvider`
 * (author-facing duplicate checking) are thin wrappers around this.
 */

export interface KnowledgeSearchHit {
  articleId: string;
  articleKey: string;
  slug: string;
  title: string;
  summary: string;
  departmentId: string;
  status: string;
  internalOnly: boolean;
  score: number;
  matchReasons: string[];
}

export interface KnowledgeSearchOptions {
  statuses: Array<"DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED">;
  departmentId?: string;
  limit?: number;
  /**
   * Include internal-only articles in results. Defaults to false so any new
   * caller is customer-safe by default -- staff-only callers (duplicate
   * checking, the ticket-detail "similar articles" panel) opt in explicitly.
   */
  includeInternalOnly?: boolean;
}

interface RawRow {
  id: string;
  articleKey: string;
  slug: string;
  title: string;
  summary: string;
  departmentId: string;
  status: string;
  internalOnly: boolean;
  ts_score: number | null;
  title_sim: number;
  summary_sim: number;
}

export async function searchKnowledgeArticles(
  rawQuery: string,
  options: KnowledgeSearchOptions,
): Promise<KnowledgeSearchHit[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  const limit = options.limit ?? 5;
  const statuses = Prisma.join(
    options.statuses.map((s) => Prisma.sql`${s}::"KnowledgeArticleStatus"`),
  );
  const departmentFilter = options.departmentId
    ? Prisma.sql`AND ka."departmentId" = ${options.departmentId}`
    : Prisma.empty;
  const internalOnlyFilter = options.includeInternalOnly
    ? Prisma.empty
    : Prisma.sql`AND ka."internalOnly" = false`;

  const rows = await db.$queryRaw<RawRow[]>`
    SELECT
      ka.id,
      ka."articleKey",
      ka.slug,
      ka.title,
      ka.summary,
      ka."departmentId",
      ka.status::text AS status,
      ka."internalOnly",
      ts_rank_cd(ka."searchVector", plainto_tsquery('english', ${query})) AS ts_score,
      similarity(ka.title, ${query}) AS title_sim,
      similarity(ka.summary, ${query}) AS summary_sim
    FROM "KnowledgeArticle" ka
    WHERE ka.status IN (${statuses})
      ${departmentFilter}
      ${internalOnlyFilter}
      AND (
        ka."searchVector" @@ plainto_tsquery('english', ${query})
        OR similarity(ka.title, ${query}) > 0.15
        OR similarity(ka.summary, ${query}) > 0.1
      )
    ORDER BY (
      coalesce(ts_rank_cd(ka."searchVector", plainto_tsquery('english', ${query})), 0) * 2
      + similarity(ka.title, ${query})
      + similarity(ka.summary, ${query}) * 0.5
    ) DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => {
    const score = (row.ts_score ?? 0) * 2 + row.title_sim + row.summary_sim * 0.5;
    const matchReasons: string[] = [];
    if ((row.ts_score ?? 0) > 0)
      matchReasons.push("matching keywords in title/summary/tags");
    if (row.title_sim > 0.15) matchReasons.push("similar title wording");
    if (row.summary_sim > 0.1) matchReasons.push("similar summary wording");
    if (matchReasons.length === 0) matchReasons.push("weak textual similarity");

    return {
      articleId: row.id,
      articleKey: row.articleKey,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      departmentId: row.departmentId,
      status: row.status,
      internalOnly: row.internalOnly,
      score,
      matchReasons,
    };
  });
}
