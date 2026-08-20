import { archiveArticle } from "@/lib/knowledge/knowledge-service";
import { withAuth } from "@/lib/http/route-helpers";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  return withAuth((actor) => archiveArticle(actor, articleId));
}
