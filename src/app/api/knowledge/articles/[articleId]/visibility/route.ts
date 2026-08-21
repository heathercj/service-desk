import type { NextRequest } from "next/server";
import { z } from "zod";
import { setArticleVisibility } from "@/lib/knowledge/knowledge-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ internalOnly: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  return withAuth(async (actor) => {
    const { internalOnly } = schema.parse(await req.json());
    return setArticleVisibility(actor, articleId, internalOnly);
  });
}
