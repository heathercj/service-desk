import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getKnowledgeSearchProvider,
  recordSimilarityCheck,
} from "@/lib/knowledge/similarity";
import { requireActiveDepartment } from "@/lib/tickets/department-lookup";
import { departmentKeySchema } from "@/lib/validation/ticket-schemas";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  proposedTitle: z.string().min(1),
  proposedSummary: z.string().min(1),
  departmentKey: departmentKeySchema.optional(),
  tags: z.array(z.string()).default([]),
  ticketId: z.string().uuid().optional(),
});

/** Author-facing duplicate/similarity check before drafting a new article (Section 11.2). */
export async function POST(req: NextRequest) {
  return withAuth(
    async (actor) => {
      const input = schema.parse(await req.json());
      const department = input.departmentKey
        ? await requireActiveDepartment(input.departmentKey)
        : undefined;

      const results = await getKnowledgeSearchProvider().findSimilarArticles({
        proposedTitle: input.proposedTitle,
        proposedSummary: input.proposedSummary,
        departmentId: department?.id,
        tags: input.tags,
      });

      await recordSimilarityCheck({
        ticketId: input.ticketId,
        performedById: actor.userId,
        rawQueryText: `${input.proposedTitle} ${input.proposedSummary}`,
        candidateArticleIds: results.map((r) => r.articleId),
      });

      return { results };
    },
    { rateLimit: { scope: "knowledge-search", windowMs: 60_000, max: 60 } },
  );
}
