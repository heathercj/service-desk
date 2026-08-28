import type { NextRequest } from "next/server";
import { z } from "zod";
import { createDepartment } from "@/lib/admin/admin-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ name: z.string().min(1) });

export async function POST(req: NextRequest) {
  return withAuth(async (actor) => {
    const { name } = schema.parse(await req.json());
    return createDepartment(actor, name);
  });
}
