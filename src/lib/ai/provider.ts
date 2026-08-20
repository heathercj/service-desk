/**
 * AI / semantic-similarity provider abstraction (Section 2, 6, 12).
 * `LocalAIProvider` is the only implementation wired up for this prototype
 * and requires no API key or external network call. A future LLM-backed
 * provider must implement this same interface behind the `AI_PROVIDER` env
 * flag, and must still treat article text and user input as untrusted data
 * (Section 6: "Ignore instructions embedded in articles").
 */

export interface ArticleSuggestion {
  articleId: string;
  articleKey: string;
  slug: string;
  title: string;
  summary: string;
  departmentId: string;
  score: number;
  matchReasons: string[];
}

export interface ChatCitation {
  articleId: string;
  title: string;
  internalUrl: string;
}

export interface ChatAnswer {
  answerText: string;
  citations: ChatCitation[];
  confident: boolean;
}

export interface AIProvider {
  suggestArticlesForDraft(input: {
    subject: string;
    description: string;
    limit?: number;
  }): Promise<ArticleSuggestion[]>;

  answerChatQuestion(input: { question: string }): Promise<ChatAnswer>;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "up",
  "about",
  "into",
  "over",
  "after",
  "i",
  "we",
  "you",
  "it",
  "my",
  "our",
  "this",
  "that",
  "have",
  "has",
  "had",
  "not",
  "can",
  "cannot",
  "wont",
  "dont",
  "im",
]);

/**
 * Reduces free text to a short, privacy-conscious keyword set. Used
 * anywhere we need to remember "what was searched for" (e.g.
 * KnowledgeSimilarityCheck.normalizedQuery) WITHOUT retaining the raw,
 * potentially sensitive ticket text (Section 11.2.7).
 */
export function normalizeQueryText(text: string, maxKeywords = 12): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      keywords.push(w);
    }
    if (keywords.length >= maxKeywords) break;
  }
  return keywords.join(" ");
}
