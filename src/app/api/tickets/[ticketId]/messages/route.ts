import type { NextRequest } from "next/server";
import { conversationMessageSchema } from "@/lib/validation/ticket-schemas";
import { addConversationMessage } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(
    async (actor) => {
      const body = await req.json();
      const input = conversationMessageSchema.parse({ ...body, ticketId });
      return addConversationMessage(actor, input);
    },
    { rateLimit: { scope: "ticket-message", windowMs: 60_000, max: 20 } },
  );
}
