import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { graphFetch } from "./client";

/**
 * Tracks the Inbox subscription for the support mailbox in the generic
 * AppSetting key-value table -- no dedicated table needed for one row.
 */
export const SUBSCRIPTION_SETTING_KEY = "graph_email_subscription";

// Graph's own max lifetime for a message-resource subscription is 4230
// minutes (~2.94 days). Renewing a little earlier keeps margin.
const SUBSCRIPTION_LIFETIME_MINUTES = 4200;

interface StoredSubscription {
  id: string;
  expirationDateTime: string;
}

async function saveSubscriptionState(sub: StoredSubscription): Promise<void> {
  const value = sub as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({
    where: { key: SUBSCRIPTION_SETTING_KEY },
    create: { key: SUBSCRIPTION_SETTING_KEY, value },
    update: { value },
  });
}

/**
 * One-time setup, run via `pnpm graph:subscribe` (scripts/graph-subscribe.ts)
 * once this is deployed somewhere Graph can reach -- local dev has no
 * public HTTPS endpoint for Graph to call back to. See docs/ENTRA_SETUP.md.
 */
export async function createGraphSubscription(): Promise<StoredSubscription> {
  const expirationDateTime = new Date(
    Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000,
  ).toISOString();

  const res = await graphFetch("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: `${env.APP_BASE_URL}/api/webhooks/graph-email`,
      lifecycleNotificationUrl: `${env.APP_BASE_URL}/api/webhooks/graph-email`,
      resource: `/users/${env.SUPPORT_MAILBOX_ADDRESS}/mailFolders('Inbox')/messages`,
      expirationDateTime,
      clientState: env.GRAPH_WEBHOOK_CLIENT_STATE,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create the Graph subscription: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { id: string };
  const stored = { id: data.id, expirationDateTime };
  await saveSubscriptionState(stored);
  return stored;
}

/**
 * Called from the webhook route on a `reauthorizationRequired` lifecycle
 * notification -- Graph's own recommended self-renewal pattern, chosen so
 * this feature needs no external scheduler.
 */
export async function renewGraphSubscription(subscriptionId: string): Promise<void> {
  const expirationDateTime = new Date(
    Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000,
  ).toISOString();

  const res = await graphFetch(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to renew the Graph subscription: ${res.status} ${await res.text()}`,
    );
  }
  await saveSubscriptionState({ id: subscriptionId, expirationDateTime });
}
