import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAIProvider } from "@/lib/ai/local-provider";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  subject: z.string().max(150).default(""),
  description: z.string().max(8000).default(""),
});

/**
 * Backs the "relevant knowledge before ticket creation" experience
 * (Section 6). Runs entirely against the local Postgres-backed search --
 * nothing here is ever sent to an external AI provider.
 */
export async function POST(req: NextRequest) {
  return withAuth(
    async () => {
      const { subject, description } = schema.parse(await req.json());
      if (subject.trim().length < 3 && description.trim().length < 10) {
        return { suggestions: [] };
      }
      const suggestions = await getAIProvider().suggestArticlesForDraft({
        subject,
        description,
        limit: 5,
      });
      return { suggestions };
    },
    { rateLimit: { scope: "knowledge-search", windowMs: 60_000, max: 60 } },
  );
}
