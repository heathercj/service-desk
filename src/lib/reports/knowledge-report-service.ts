import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { assertAuthorized } from "@/lib/rbac/errors";
import { canViewKnowledgeReports, toPolicyActor } from "@/lib/rbac/policies";

export interface KnowledgeReportFilters {
  /** Days since contentUpdatedAt before an article is flagged stale. */
  staleDays?: number;
}

export interface ArticleReportRow {
  articleId: string;
  title: string;
  departmentName: string;
  status: string;
  contentUpdatedAt: Date;
  ageInDays: number;
  usageCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  deflectionCount: number;
  ticketsSolvedCount: number;
  isStale: boolean;
  isUnused: boolean;
}

const DEFAULT_STALE_DAYS = 365;
const MS_PER_DAY = 86_400_000;

/**
 * KB article health: staleness (by contentUpdatedAt, deliberately NOT
 * `updatedAt` -- see the migration adding contentUpdatedAt, since
 * `updatedAt` is bumped on every article *view*), zero-engagement, and
 * a "tickets solved" ranking. Excludes ARCHIVED articles (deliberately
 * retired, not something needing review).
 */
export async function getKnowledgeReport(
  actor: AuthContext,
  filters: KnowledgeReportFilters,
): Promise<ArticleReportRow[]> {
  assertAuthorized(
    canViewKnowledgeReports(toPolicyActor(actor)),
    "You cannot view knowledge reports",
  );

  const staleDays = filters.staleDays ?? DEFAULT_STALE_DAYS;
  const staleCutoff = new Date(Date.now() - staleDays * MS_PER_DAY);

  const articles = await db.knowledgeArticle.findMany({
    where: { status: { not: "ARCHIVED" } },
    include: {
      department: { select: { name: true } },
      _count: {
        select: {
          ticketLinks: true,
          // Filtered relation count: cannot be used in orderBy, so
          // "sort by tickets solved" is done in JS over this result.
        },
      },
      ticketLinks: {
        where: { outcomeType: "LINKED_EXISTING" },
        select: { id: true },
      },
    },
  });

  const now = Date.now();
  return articles
    .map((a) => {
      const ageInDays = Math.floor((now - a.contentUpdatedAt.getTime()) / MS_PER_DAY);
      const totalEngagement =
        a.usageCount +
        a.helpfulCount +
        a.notHelpfulCount +
        a.deflectionCount +
        a._count.ticketLinks;
      return {
        articleId: a.id,
        title: a.title,
        departmentName: a.department.name,
        status: a.status,
        contentUpdatedAt: a.contentUpdatedAt,
        ageInDays,
        usageCount: a.usageCount,
        helpfulCount: a.helpfulCount,
        notHelpfulCount: a.notHelpfulCount,
        deflectionCount: a.deflectionCount,
        ticketsSolvedCount: a.ticketLinks.length,
        isStale: a.contentUpdatedAt < staleCutoff,
        isUnused: totalEngagement === 0,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
