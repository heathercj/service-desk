import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { canDraftOrLinkKnowledge, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArticleManageActions } from "./article-manage-actions";

const STATUSES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const;

export default async function KnowledgeManagePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const policyActor = toPolicyActor(auth);
  if (!canDraftOrLinkKnowledge(policyActor)) {
    return (
      <AccessDenied message="Only staff can view the knowledge management console." />
    );
  }

  const isManager =
    auth.roles.has("KNOWLEDGE_MANAGER") || auth.roles.has("ADMINISTRATOR");

  const articles = await db.knowledgeArticle.findMany({
    include: { department: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Knowledge management</h1>

      {STATUSES.map((status) => {
        const group = articles.filter((a) => a.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="mb-3 text-lg font-semibold">{status.replaceAll("_", " ")}</h2>
            <div className="grid gap-3">
              {group.map((a) => (
                <Card key={a.id}>
                  <CardContent
                    data-tour="article-row"
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div>
                      <Link
                        href={`/knowledge/${a.slug}`}
                        className="font-medium hover:underline"
                      >
                        {a.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {a.department.name} · Rev {a.revision} · Used {a.usageCount}{" "}
                        time(s) · {a.helpfulCount}👍 / {a.notHelpfulCount}👎
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{a.status}</Badge>
                      {a.internalOnly && <Badge variant="warning">Internal only</Badge>}
                      {isManager && (
                        <ArticleManageActions
                          articleId={a.id}
                          status={a.status}
                          internalOnly={a.internalOnly}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
