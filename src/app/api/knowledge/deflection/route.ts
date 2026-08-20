import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordDeflectionEvent } from "@/lib/knowledge/knowledge-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ articleId: z.string().uuid() });

/**
 * Records a privacy-conscious deflection event when a customer says an
 * article solved their issue and abandons ticket creation (Section 6).
 * Deliberately stores no ticket text, only the article + optional actor.
 */
export async function POST(req: NextRequest) {
  return withAuth(async (actor) => {
    const { articleId } = schema.parse(await req.json());
    await recordDeflectionEvent(articleId, actor.userId);
    return { ok: true };
  });
}
