import type { NextRequest } from "next/server";
import { z } from "zod";
import { provisionUserByEmail } from "@/lib/admin/admin-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  return withAuth(async (actor) => {
    const { email } = schema.parse(await req.json());
    return provisionUserByEmail(actor, email);
  });
}
