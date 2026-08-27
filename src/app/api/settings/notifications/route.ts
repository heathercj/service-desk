import { z } from "zod";
import { updateNotificationPreferences } from "@/lib/notifications/preferences-service";
import { withAuth } from "@/lib/http/route-helpers";

const schema = z.object({
  ticketAssignedEmail: z.boolean(),
  ticketCommentedEmail: z.boolean(),
  knowledgeArticlePublishedEmail: z.boolean(),
});

export async function PUT(req: Request) {
  return withAuth(async (actor) => {
    const input = schema.parse(await req.json());
    return updateNotificationPreferences(actor, input);
  });
}
