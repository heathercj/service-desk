import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAIProvider } from "@/lib/ai/local-provider";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ question: z.string().trim().min(1).max(1000) });

/**
 * Retrieval-only chat assistant (Section 6). Treats the question as
 * untrusted input and article content as untrusted data; there is no LLM
 * here to hijack via injected instructions -- answers are templated from
 * deterministic full-text search results only.
 */
export async function POST(req: NextRequest) {
  return withAuth(
    async () => {
      const { question } = schema.parse(await req.json());
      const answer = await getAIProvider().answerChatQuestion({ question });
      return answer;
    },
    { rateLimit: { scope: "chat", windowMs: 60_000, max: 30 } },
  );
}
