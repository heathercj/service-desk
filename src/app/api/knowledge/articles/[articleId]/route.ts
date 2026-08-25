import type { NextRequest } from "next/server";
import { getArticleByIdForActor } from "@/lib/knowledge/knowledge-service";
import { readArticleFile } from "@/lib/knowledge/markdown-repo";
import { withAuth } from "@/lib/http/route-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  return withAuth(async (actor) => {
    const article = await getArticleByIdForActor(actor, articleId);
    const file = await readArticleFile(article.filePath);
    return {
      id: article.id,
      title: article.title,
      summary: article.summary,
      departmentName: article.department.name,
      body: file.body,
    };
  });
}
