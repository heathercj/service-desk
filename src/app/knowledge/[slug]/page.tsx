import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { getAuthContext } from "@/lib/auth/session";
import { getArticleForActor } from "@/lib/knowledge/knowledge-service";
import { readArticleFile } from "@/lib/knowledge/markdown-repo";
import { NotFoundError, ForbiddenError } from "@/lib/rbac/errors";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/ui/badge";
import { ArticleFeedback } from "./article-feedback";

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const auth = await getAuthContext();

  let article;
  try {
    article = await getArticleForActor(auth, slug);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  const file = await readArticleFile(article.filePath);

  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <div>
        <Badge variant="outline">{article.department.name}</Badge>
        {article.internalOnly && (
          <Badge variant="warning" className="ml-2">
            Internal only
          </Badge>
        )}
        <h1 className="mt-2 text-2xl font-semibold">{article.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{article.summary}</p>
      </div>

      {/* rehype-sanitize strips any raw HTML / unsafe attributes; Section 11
          requires disabling raw HTML by default in rendered Markdown. */}
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {file.body}
        </ReactMarkdown>
      </div>

      {auth && <ArticleFeedback articleId={article.id} />}
    </article>
  );
}
