import "dotenv/config";
import { env } from "../src/lib/env";
import { createGraphSubscription } from "../src/lib/graph/mailbox-subscription";

/**
 * One-time setup: creates the Graph webhook subscription on the support
 * mailbox. Run this once this app is deployed somewhere Microsoft Graph
 * can reach over public HTTPS -- local dev has no such endpoint, so this
 * cannot be exercised from a laptop. See docs/ENTRA_SETUP.md.
 *
 *   pnpm graph:subscribe
 */
async function main() {
  if (!env.ENABLE_EMAIL_INTAKE) {
    console.error(
      "Refusing to run: ENABLE_EMAIL_INTAKE is not true. Set it, along with " +
        "SUPPORT_MAILBOX_ADDRESS and GRAPH_WEBHOOK_CLIENT_STATE, first.",
    );
    process.exit(1);
  }

  const subscription = await createGraphSubscription();
  console.log(
    `Created Graph subscription ${subscription.id}, expiring ${subscription.expirationDateTime}.\n` +
      `It will self-renew from here on (see src/app/api/webhooks/graph-email/route.ts).`,
  );
}

main().catch((err) => {
  console.error("graph:subscribe failed:", err);
  process.exit(1);
});
