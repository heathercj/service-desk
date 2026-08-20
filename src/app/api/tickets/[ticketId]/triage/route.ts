import type { NextRequest } from "next/server";
import { triageActionSchema } from "@/lib/validation/ticket-schemas";
import { confirmTriage } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(async (actor) => {
    const body = await req.json();
    const input = triageActionSchema.parse({ ...body, ticketId });
    return confirmTriage(actor, input);
  });
}
