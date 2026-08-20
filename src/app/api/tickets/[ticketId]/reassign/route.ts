import type { NextRequest } from "next/server";
import { z } from "zod";
import { reassignTicket } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  version: z.number().int().positive(),
  targetUserId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(async (actor) => {
    const { version, targetUserId } = schema.parse(await req.json());
    return reassignTicket(actor, ticketId, version, targetUserId);
  });
}
