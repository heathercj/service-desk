import type { NextRequest } from "next/server";
import { z } from "zod";
import { setUserActive } from "@/lib/admin/admin-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ isActive: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return withAuth(async (actor) => {
    const { isActive } = schema.parse(await req.json());
    return setUserActive(actor, userId, isActive);
  });
}
