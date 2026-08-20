import type { NextRequest } from "next/server";
import { createTicketSchema } from "@/lib/validation/ticket-schemas";
import { createTicket } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

export async function POST(req: NextRequest) {
  return withAuth(
    async (actor) => {
      const body = await req.json();
      const input = createTicketSchema.parse(body);
      const ticket = await createTicket(actor, input);
      return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber };
    },
    { rateLimit: { scope: "ticket-create", windowMs: 60_000, max: 10 } },
  );
}
