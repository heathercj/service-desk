import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordKnowledgeOutcome } from "@/lib/knowledge/knowledge-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  articleId: z.string().uuid().optional(),
  outcomeType: z.enum(["LINKED_EXISTING", "PROPOSED_UPDATE", "NEW_DRAFT", "EXCEPTION"]),
  reason: z.string().trim().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(async (actor) => {
    const input = schema.parse(await req.json());
    return recordKnowledgeOutcome(actor, { ticketId, ...input });
  });
}
