import type { NextRequest } from "next/server";
import { z } from "zod";
import { DEPARTMENT_KEYS } from "@/lib/validation/ticket-schemas";
import { createDraftArticle } from "@/lib/knowledge/knowledge-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  title: z.string().trim().min(3).max(150),
  summary: z.string().trim().min(10).max(500),
  departmentKey: z.enum(DEPARTMENT_KEYS),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  body: z.string().trim().min(20).max(20000),
  sourceTicketId: z.string().uuid().optional(),
  similarityCandidateArticleIds: z.array(z.string()).default([]),
  highSimilarityOverrideReason: z.string().trim().max(1000).optional(),
  internalOnly: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  return withAuth(async (actor) => {
    const input = schema.parse(await req.json());
    const article = await createDraftArticle(actor, input);
    return { articleId: article.id, slug: article.slug };
  });
}
