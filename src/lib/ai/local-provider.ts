import "server-only";
import { searchKnowledgeArticles } from "@/lib/knowledge/search";
import type { AIProvider, ArticleSuggestion, ChatAnswer } from "./provider";

const KB_ARTICLE_BASE_PATH = "/knowledge";

export class LocalAIProvider implements AIProvider {
  async suggestArticlesForDraft(input: {
    subject: string;
    description: string;
    limit?: number;
  }): Promise<ArticleSuggestion[]> {
    const query = `${input.subject}\n${input.description}`.trim();
    if (!query) return [];

    const hits = await searchKnowledgeArticles(query, {
      statuses: ["PUBLISHED"],
      limit: input.limit ?? 5,
    });

    return hits.map((hit) => ({
      articleId: hit.articleId,
      articleKey: hit.articleKey,
      slug: hit.slug,
      title: hit.title,
      summary: hit.summary,
      departmentId: hit.departmentId,
      score: hit.score,
      matchReasons: hit.matchReasons,
    }));
  }

  async answerChatQuestion(input: { question: string }): Promise<ChatAnswer> {
    const question = input.question.trim();
    if (!question) {
      return {
        answerText:
          "Please ask a question about a Technology Support, Training, Accounting, Marketing, or Legal topic.",
        citations: [],
        confident: false,
      };
    }

    const hits = await searchKnowledgeArticles(question, {
      statuses: ["PUBLISHED"],
      limit: 3,
    });

    if (hits.length === 0) {
      return {
        answerText:
          "I don't have a published knowledge article that answers this yet. I can start a ticket for you instead, and a specialist will follow up.",
        citations: [],
        confident: false,
      };
    }

    const top = hits[0]!;
    const answerText = [
      `Here's what our knowledge base says about "${question}":`,
      "",
      `**${top.title}** -- ${top.summary}`,
      "",
      hits.length > 1
        ? `Related articles: ${hits
            .slice(1)
            .map((h) => h.title)
            .join(", ")}.`
        : "",
      "",
      "If this doesn't solve it, I can continue to ticket creation and carry this conversation into the description.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      answerText,
      citations: hits.map((h) => ({
        articleId: h.articleId,
        title: h.title,
        internalUrl: `${KB_ARTICLE_BASE_PATH}/${h.slug}`,
      })),
      confident: true,
    };
  }
}

let provider: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (!provider) {
    provider = new LocalAIProvider();
  }
  return provider;
}
