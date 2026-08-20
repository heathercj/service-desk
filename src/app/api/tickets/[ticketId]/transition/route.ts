import type { NextRequest } from "next/server";
import { statusChangeSchema } from "@/lib/validation/ticket-schemas";
import { transitionTicketStatus } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(async (actor) => {
    const body = await req.json();
    const input = statusChangeSchema.parse({ ...body, ticketId });
    return transitionTicketStatus(actor, input);
  });
}
