import type { NextRequest } from "next/server";
import { z } from "zod";
import { selfAssignTicket } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ version: z.number().int().positive() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(async (actor) => {
    const { version } = schema.parse(await req.json());
    return selfAssignTicket(actor, ticketId, version);
  });
}
