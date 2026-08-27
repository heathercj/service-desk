import "dotenv/config";
import { sendDormantTicketAlerts } from "../src/lib/tickets/dormant-ticket-service";

/**
 * Sweeps for tickets assigned to someone but untouched for 3+ days and
 * emails the assignee -- mandatory, not gated by notification preferences.
 * No in-process job runner exists in this repo (see docs/LAUNCH_RUNBOOK.md),
 * so this is meant to be invoked periodically (daily) by an external
 * scheduler -- OS cron, Windows Task Scheduler, or the hosting platform's
 * scheduled-task feature -- the same way `graph:subscribe` is a manual
 * script rather than an in-process timer.
 *
 *   pnpm dormant:check
 */
async function main() {
  const alerted = await sendDormantTicketAlerts(new Date());
  if (alerted.length === 0) {
    console.log("No dormant tickets found.");
    return;
  }
  console.log(
    `Alerted assignees on ${alerted.length} dormant ticket(s): ${alerted.join(", ")}`,
  );
}

main().catch((err) => {
  console.error("dormant:check failed:", err);
  process.exit(1);
});
