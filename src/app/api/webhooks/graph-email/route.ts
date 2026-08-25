import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { graphFetch } from "@/lib/graph/client";
import { renewGraphSubscription } from "@/lib/graph/mailbox-subscription";
import { createTicketFromEmail } from "@/lib/tickets/email-intake-service";

/**
 * Microsoft Graph webhook for the support mailbox (Section: email intake).
 * Unauthenticated by design -- Graph calls this directly with no session
 * to present (see PUBLIC_PATHS in src/middleware.ts) -- so clientState is
 * the security boundary here, not auth.
 */

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  resourceData?: { id: string };
  lifecycleEvent?: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
}

interface GraphMessage {
  subject: string;
  bodyPreview: string;
  from?: { emailAddress?: { address?: string; name?: string } };
}

/**
 * The change notification itself carries no email content, only the
 * changed message's id -- this fetches the actual subject/sender/body.
 * bodyPreview (a plain-text excerpt), not the full body.content, which
 * would need HTML parsing/sanitization -- a v1 scope choice, not a limit
 * of what Graph offers.
 */
async function fetchMessage(messageId: string): Promise<GraphMessage | null> {
  const res = await graphFetch(
    `/users/${encodeURIComponent(env.SUPPORT_MAILBOX_ADDRESS)}/messages/` +
      `${encodeURIComponent(messageId)}?$select=subject,bodyPreview,from`,
  );
  if (!res.ok) return null;
  return (await res.json()) as GraphMessage;
}

export async function POST(req: NextRequest) {
  // Graph's subscription-creation/validation handshake: echo the token
  // back as plain text within 10 seconds, nothing else.
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken !== null) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const payload = (await req.json()) as { value?: GraphNotification[] };
  const notifications = payload.value ?? [];

  // Reject the whole batch on any spoofed entry rather than picking
  // through it -- a mismatched clientState means this didn't come from
  // our subscription.
  for (const notification of notifications) {
    if (notification.clientState !== env.GRAPH_WEBHOOK_CLIENT_STATE) {
      return NextResponse.json({ error: "Invalid clientState" }, { status: 401 });
    }
  }

  for (const notification of notifications) {
    if (notification.lifecycleEvent) {
      if (notification.lifecycleEvent === "reauthorizationRequired") {
        await renewGraphSubscription(notification.subscriptionId);
      }
      continue;
    }

    const messageId = notification.resourceData?.id;
    if (!messageId) continue;

    const message = await fetchMessage(messageId);
    if (!message) continue;

    await createTicketFromEmail({
      graphMessageId: messageId,
      fromEmail: message.from?.emailAddress?.address ?? "",
      fromName: message.from?.emailAddress?.name ?? "",
      subject: message.subject,
      bodyText: message.bodyPreview,
    });
  }

  return new NextResponse(null, { status: 202 });
}
