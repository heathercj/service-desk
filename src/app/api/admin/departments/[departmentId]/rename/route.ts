import type { NextRequest } from "next/server";
import { z } from "zod";
import { renameDepartment } from "@/lib/admin/admin-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({ name: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ departmentId: string }> },
) {
  const { departmentId } = await params;
  return withAuth(async (actor) => {
    const { name } = schema.parse(await req.json());
    return renameDepartment(actor, departmentId, name);
  });
}
