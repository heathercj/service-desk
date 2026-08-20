import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordArticleFeedback } from "@/lib/knowledge/knowledge-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  articleId: z.string().uuid(),
  ticketId: z.string().uuid().optional(),
  wasHelpful: z.boolean(),
});

export async function POST(req: NextRequest) {
  return withAuth(async (actor) => {
    const { articleId, ticketId, wasHelpful } = schema.parse(await req.json());
    await recordArticleFeedback(actor, articleId, ticketId, wasHelpful);
    return { ok: true };
  });
}
