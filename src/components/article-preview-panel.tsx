"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ArticlePreview {
  title: string;
  summary: string;
  departmentName: string;
  body: string;
}

/**
 * Slide-in panel for reading a suggested knowledge article's full content
 * without leaving the ticket form (Section 6) -- replaces the previous
 * "opens in a new tab" link, which was the extra click a product manager
 * flagged. Reuses the same sanitized-Markdown rendering as the standalone
 * article page (src/app/knowledge/[slug]/page.tsx).
 */
export function ArticlePreviewPanel({
  articleId,
  onClose,
  onDeflect,
}: {
  articleId: string | null;
  onClose: () => void;
  onDeflect?: () => void;
}) {
  const [article, setArticle] = useState<ArticlePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setArticle(null);

    fetch(`/api/knowledge/articles/${articleId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load this article.");
        return (await res.json()) as ArticlePreview;
      })
      .then((data) => {
        if (!cancelled) setArticle(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this article.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [articleId]);

  if (!articleId) return null;

  return (
    <aside
      role="dialog"
      aria-label="Knowledge article preview"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-background p-6 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {article?.title ?? "Loading article..."}
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {loading && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {article && (
        <>
          <Badge variant="outline" className="mt-2">
            {article.departmentName}
          </Badge>
          <p className="mt-3 text-sm text-muted-foreground">{article.summary}</p>
          {/* rehype-sanitize strips raw HTML / unsafe attributes, matching
              the standalone article page's rendering (Section 11). */}
          <div className="markdown-body mt-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {article.body}
            </ReactMarkdown>
          </div>
          {onDeflect && (
            <Button type="button" className="mt-6" onClick={onDeflect}>
              This solved it
            </Button>
          )}
        </>
      )}
    </aside>
  );
}
