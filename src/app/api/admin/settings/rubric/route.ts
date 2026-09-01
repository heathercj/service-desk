import type { NextRequest } from "next/server";
import { z } from "zod";
import { saveRubric } from "@/lib/reports/rubric-settings-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  targetHoursByPriority: z.object({
    LOW: z.number().positive(),
    MEDIUM: z.number().positive(),
    HIGH: z.number().positive(),
    URGENT: z.number().positive(),
  }),
  graceHours: z.number().positive(),
});

export async function POST(req: NextRequest) {
  return withAuth(async (actor) => {
    const rubric = schema.parse(await req.json());
    return saveRubric(actor, rubric);
  });
}
