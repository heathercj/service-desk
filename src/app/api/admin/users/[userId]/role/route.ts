import type { NextRequest } from "next/server";
import { z } from "zod";
import { setUserRole } from "@/lib/admin/admin-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  role: z.enum([
    "CUSTOMER",
    "TRIAGE_AGENT",
    "DEPARTMENT_AGENT",
    "DEPARTMENT_MANAGER",
    "KNOWLEDGE_MANAGER",
    "ADMINISTRATOR",
  ]),
  enabled: z.boolean(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return withAuth(async (actor) => {
    const { role, enabled } = schema.parse(await req.json());
    await setUserRole(actor, userId, role, enabled);
    return { ok: true };
  });
}
