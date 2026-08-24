import type { NextRequest } from "next/server";
import { z } from "zod";
import { DEPARTMENT_KEYS } from "@/lib/validation/ticket-schemas";
import { transferDepartment } from "@/lib/tickets/ticket-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  version: z.number().int().positive(),
  departmentKey: z.enum(DEPARTMENT_KEYS),
  reason: z.string().trim().min(1, "A reason is required to transfer a ticket").max(2000),
  newAssigneeId: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;
  return withAuth(async (actor) => {
    const { version, departmentKey, reason, newAssigneeId } = schema.parse(
      await req.json(),
    );
    return transferDepartment(
      actor,
      ticketId,
      version,
      departmentKey,
      reason,
      newAssigneeId,
    );
  });
}
