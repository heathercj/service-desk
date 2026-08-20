import "server-only";
import { randomBytes } from "node:crypto";
import type { DepartmentKey, KnowledgeOutcomeType } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import {
  canArchiveArticle,
  canDraftOrLinkKnowledge,
  canPublishArticle,
  canRecordKnowledgeException,
  canViewKnowledgeArticle,
  toPolicyActor,
} from "@/lib/rbac/policies";
import { assertAuthorized, NotFoundError } from "@/lib/rbac/errors";
import { recordAuditEvent } from "@/lib/audit/audit-log";
import { requireActiveDepartment } from "@/lib/tickets/department-lookup";
import { retryResolutionAfterKnowledgeOutcome } from "@/lib/tickets/ticket-service";
import { slugify, type KnowledgeFrontMatter } from "./front-matter-schema";
import { departmentKeyToFolder } from "./department-folders";
import { writeArticleFile } from "./markdown-repo";
import { recordSimilarityCheck } from "./similarity";

function newArticleKey(): string {
  return `KB-${randomBytes(4).toString("hex")}`;
}

export interface CreateDraftArticleInput {
  title: string;
  summary: string;
  departmentKey: DepartmentKey;
  tags: string[];
  body: string;
  sourceTicketId?: string;
  similarityCandidateArticleIds?: string[];
  highSimilarityOverrideReason?: string;
}

export async function createDraftArticle(
  actor: AuthContext,
  input: CreateDraftArticleInput,
) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(
    canDraftOrLinkKnowledge(policyActor),
    "You cannot draft knowledge articles",
  );

  const department = await requireActiveDepartment(input.departmentKey);
  const slug = slugify(input.title);
  const articleKey = newArticleKey();
  const today = new Date().toISOString().slice(0, 10);

  const frontMatter: KnowledgeFrontMatter = {
    id: articleKey,
    title: input.title,
    slug,
    summary: input.summary,
    department: input.departmentKey,
    status: "draft",
    tags: input.tags,
    createdDate: today,
    updatedDate: today,
    createdBy: actor.userId,
    sourceTicketIds: input.sourceTicketId ? [input.sourceTicketId] : [],
    revision: 1,
  };

  const file = await writeArticleFile(input.departmentKey, slug, frontMatter, input.body);

  const article = await db.$transaction(async (tx) => {
    const created = await tx.knowledgeArticle.create({
      data: {
        articleKey,
        slug,
        departmentId: department.id,
        title: input.title,
        summary: input.summary,
        status: "DRAFT",
        filePath: file.relativePath,
        contentHash: file.contentHash,
        revision: 1,
        createdById: actor.userId,
      },
    });

    for (const name of input.tags) {
      const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
      await tx.knowledgeArticleTag.create({
        data: { articleId: created.id, tagId: tag.id },
      });
    }

    await tx.knowledgeArticleRevision.create({
      data: {
        articleId: created.id,
        revision: 1,
        contentSnapshot: input.body,
        editedById: actor.userId,
        changeSummary: "Initial draft",
      },
    });

    await recordAuditEvent(
      {
        actorId: actor.userId,
        actorDisplayName: actor.displayName,
        action: "KNOWLEDGE_ARTICLE_DRAFTED",
        entityType: "KnowledgeArticle",
        entityId: created.id,
        newValue: {
          title: input.title,
          departmentId: department.id,
          sourceTicketId: input.sourceTicketId,
        },
      },
      tx,
    );

    return created;
  });

  await recordSimilarityCheck({
    ticketId: input.sourceTicketId,
    performedById: actor.userId,
    rawQueryText: `${input.title} ${input.summary}`,
    candidateArticleIds: input.similarityCandidateArticleIds ?? [],
    selectedAction: "NEW_DRAFT",
  });

  return article;
}

export async function submitArticleForReview(actor: AuthContext, articleId: string) {
  const policyActor = toPolicyActor(actor);
  const article = await db.knowledgeArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new NotFoundError("Article not found");
  assertAuthorized(
    canDraftOrLinkKnowledge(policyActor),
    "You cannot submit this article for review",
  );
  assertAuthorized(
    article.status === "DRAFT",
    "Only a draft article can be submitted for review",
  );

  return db.knowledgeArticle.update({
    where: { id: articleId },
    data: { status: "IN_REVIEW" },
  });
}

export async function publishArticle(
  actor: AuthContext,
  articleId: string,
  reviewedById?: string,
) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(
    canPublishArticle(policyActor),
    "Only a knowledge manager can publish articles",
  );

  const article = await db.knowledgeArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new NotFoundError("Article not found");
  assertAuthorized(
    article.status === "DRAFT" || article.status === "IN_REVIEW",
    "Article is not publishable from its current status",
  );

  const updated = await db.knowledgeArticle.update({
    where: { id: articleId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      reviewedById: reviewedById ?? actor.userId,
    },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "KNOWLEDGE_ARTICLE_PUBLISHED",
    entityType: "KnowledgeArticle",
    entityId: articleId,
    previousValue: { status: article.status },
    newValue: { status: "PUBLISHED" },
  });

  return updated;
}

export async function archiveArticle(actor: AuthContext, articleId: string) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(
    canArchiveArticle(policyActor),
    "Only a knowledge manager can archive articles",
  );

  const article = await db.knowledgeArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new NotFoundError("Article not found");

  const updated = await db.knowledgeArticle.update({
    where: { id: articleId },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "KNOWLEDGE_ARTICLE_ARCHIVED",
    entityType: "KnowledgeArticle",
    entityId: articleId,
    previousValue: { status: article.status },
    newValue: { status: "ARCHIVED" },
  });

  return updated;
}

export async function restoreArticle(actor: AuthContext, articleId: string) {
  const policyActor = toPolicyActor(actor);
  assertAuthorized(
    canArchiveArticle(policyActor),
    "Only a knowledge manager can restore articles",
  );

  const article = await db.knowledgeArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new NotFoundError("Article not found");
  assertAuthorized(
    article.status === "ARCHIVED",
    "Only an archived article can be restored",
  );

  const updated = await db.knowledgeArticle.update({
    where: { id: articleId },
    data: { status: "PUBLISHED", archivedAt: null },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "KNOWLEDGE_ARTICLE_RESTORED",
    entityType: "KnowledgeArticle",
    entityId: articleId,
    previousValue: { status: "ARCHIVED" },
    newValue: { status: "PUBLISHED" },
  });

  return updated;
}

export interface LinkKnowledgeOutcomeInput {
  ticketId: string;
  articleId?: string;
  outcomeType: KnowledgeOutcomeType;
  reason?: string;
}

export async function recordKnowledgeOutcome(
  actor: AuthContext,
  input: LinkKnowledgeOutcomeInput,
) {
  const policyActor = toPolicyActor(actor);

  if (input.outcomeType === "EXCEPTION") {
    assertAuthorized(
      canRecordKnowledgeException(policyActor),
      "Only a knowledge manager or administrator can approve a knowledge exception",
    );
    assertAuthorized(
      Boolean(input.reason?.trim()),
      "A reason is required to record a knowledge exception",
    );
  } else {
    assertAuthorized(
      canDraftOrLinkKnowledge(policyActor),
      "You cannot record a knowledge outcome",
    );
    assertAuthorized(
      Boolean(input.articleId),
      "An article must be selected for this outcome",
    );

    if (input.articleId) {
      const article = await db.knowledgeArticle.findUnique({
        where: { id: input.articleId },
      });
      if (!article) throw new NotFoundError("Article not found");
      assertAuthorized(
        canViewKnowledgeArticle(policyActor, article),
        "You cannot link this article",
      );
    }
  }

  const link = await db.ticketKnowledgeLink.create({
    data: {
      ticketId: input.ticketId,
      // Nullable: an EXCEPTION outcome may legitimately have no article.
      articleId: input.articleId ?? null,
      outcomeType: input.outcomeType,
      createdById: actor.userId,
      reason: input.reason,
    },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "TICKET_KNOWLEDGE_OUTCOME_RECORDED",
    entityType: "Ticket",
    entityId: input.ticketId,
    newValue: {
      outcomeType: input.outcomeType,
      articleId: input.articleId,
      reason: input.reason,
    },
  });

  const gateResult = await retryResolutionAfterKnowledgeOutcome(actor, input.ticketId);
  return { link, gateResult };
}

export async function recordArticleFeedback(
  actor: AuthContext | null,
  articleId: string,
  ticketId: string | undefined,
  wasHelpful: boolean,
) {
  const article = await db.knowledgeArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new NotFoundError("Article not found");

  await db.$transaction([
    db.knowledgeFeedback.create({
      data: { articleId, ticketId, userId: actor?.userId, wasHelpful },
    }),
    db.knowledgeArticle.update({
      where: { id: articleId },
      data: wasHelpful
        ? { helpfulCount: { increment: 1 } }
        : { notHelpfulCount: { increment: 1 } },
    }),
  ]);
}

export async function recordDeflectionEvent(articleId: string, userId?: string) {
  await db.$transaction([
    db.deflectionEvent.create({ data: { articleId, userId } }),
    db.knowledgeArticle.update({
      where: { id: articleId },
      data: { deflectionCount: { increment: 1 } },
    }),
  ]);
}

export async function getArticleForActor(
  actor: AuthContext | null,
  slug: string,
  departmentKey?: DepartmentKey,
) {
  const article = departmentKey
    ? await db.knowledgeArticle.findFirst({
        where: { slug, department: { key: departmentKey } },
        include: { department: true },
      })
    : await db.knowledgeArticle.findFirst({
        where: { slug },
        include: { department: true },
      });

  if (!article) throw new NotFoundError("Article not found");

  const policyActor = actor
    ? toPolicyActor(actor)
    : { userId: "", roles: new Set<never>(), departments: new Map() };
  assertAuthorized(
    canViewKnowledgeArticle(policyActor as never, article),
    "You cannot view this article",
  );

  await db.knowledgeArticle.update({
    where: { id: article.id },
    data: { usageCount: { increment: 1 } },
  });

  return article;
}

// Only used by department-folders.ts callers that need a folder path helper
// re-exported alongside the service for convenience.
export { departmentKeyToFolder };
