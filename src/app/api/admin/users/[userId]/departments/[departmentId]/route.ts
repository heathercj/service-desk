import type { NextRequest } from "next/server";
import { z } from "zod";
import { setDepartmentMembership } from "@/lib/admin/admin-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ isMember: z.boolean(), isManager: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; departmentId: string }> },
) {
  const { userId, departmentId } = await params;
  return withAuth(async (actor) => {
    const input = schema.parse(await req.json());
    await setDepartmentMembership(actor, userId, departmentId, input);
    return { ok: true };
  });
}
