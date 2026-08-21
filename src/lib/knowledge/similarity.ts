import "server-only";
import { db } from "@/lib/db";
import { normalizeQueryText } from "@/lib/ai/provider";
import { searchKnowledgeArticles, type KnowledgeSearchHit } from "./search";

/**
 * Author-facing duplicate/similarity checking (Section 11.2). Placed
 * behind this small interface so a future embedding-based
 * `KnowledgeSearchProvider` can be swapped in without touching callers;
 * the prototype implementation is fully functional without any external
 * API (Postgres full-text + trigram only).
 */
export interface KnowledgeSearchProvider {
  findSimilarArticles(input: SimilarityCheckInput): Promise<KnowledgeSearchHit[]>;
}

export interface SimilarityCheckInput {
  proposedTitle: string;
  proposedSummary: string;
  departmentId?: string;
  tags?: string[];
  symptoms?: string;
  resolution?: string;
  limit?: number;
}

export class PostgresKnowledgeSearchProvider implements KnowledgeSearchProvider {
  async findSimilarArticles(input: SimilarityCheckInput): Promise<KnowledgeSearchHit[]> {
    const query = [
      input.proposedTitle,
      input.proposedSummary,
      input.tags?.join(" "),
      input.symptoms,
      input.resolution,
    ]
      .filter(Boolean)
      .join("\n");

    return searchKnowledgeArticles(query, {
      statuses: ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"],
      departmentId: input.departmentId,
      limit: input.limit ?? 8,
      // Staff-only duplicate/linking check -- internal-only articles must
      // still surface here so agents don't accidentally author a duplicate.
      includeInternalOnly: true,
    });
  }
}

let provider: KnowledgeSearchProvider | undefined;
export function getKnowledgeSearchProvider(): KnowledgeSearchProvider {
  if (!provider) provider = new PostgresKnowledgeSearchProvider();
  return provider;
}

export interface RecordSimilarityCheckInput {
  ticketId?: string;
  performedById: string;
  rawQueryText: string;
  candidateArticleIds: string[];
  selectedAction?: string;
}

/**
 * Records the search query, candidates, actor, and timestamp (Section
 * 11.2.7) -- deliberately storing only normalized keywords, never the raw
 * ticket/article text, so this audit trail can't become a secondary leak
 * of sensitive ticket content.
 */
export async function recordSimilarityCheck(input: RecordSimilarityCheckInput) {
  const check = await db.knowledgeSimilarityCheck.create({
    data: {
      ticketId: input.ticketId,
      performedById: input.performedById,
      normalizedQuery: normalizeQueryText(input.rawQueryText),
      candidateArticleIds: input.candidateArticleIds,
      selectedAction: input.selectedAction,
    },
  });

  // The resolution gate (Section 11.3) checks Ticket.lastKnowledgeCheckAt
  // to decide whether a knowledge check is "current" -- this must be kept
  // in sync every time a check is actually performed against a ticket.
  if (input.ticketId) {
    await db.ticket.update({
      where: { id: input.ticketId },
      data: { lastKnowledgeCheckAt: new Date() },
    });
  }

  return check;
}
