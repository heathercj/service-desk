import {
  summarizeByCustomer,
  summarizeByStaff,
  type GroupStats,
  type TicketRunRecord,
} from "./scorecard";

/**
 * A deterministic "team retro" synthesized from the same aggregate numbers
 * as the scorecard -- what each persona group found easy vs. hard/unintuitive
 * across the whole batch. Still no LLM: each line is assembled from the
 * actual escalation/rounds/exception/reopen rates recorded during the run,
 * not free-form generated opinion.
 */

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function buildStaffDiscussionLine(g: GroupStats): string {
  // A manager persona only ever receives tickets via escalation (see
  // scripts/sim-run.ts's escalation branch), so escalatedCount is trivially
  // 100% for every manager group -- that's not a finding about them, it's
  // just how they got the ticket. Only agents can meaningfully report an
  // escalation rate.
  const isManager = g.label.includes("Manager");
  const escalationRate = rate(g.escalatedCount, g.count);
  const exceptionRate = rate(g.exceptionCount, g.count);
  const avgRounds = g.totalRounds / g.count;
  const points: string[] = [];

  if (avgRounds >= 0.34) {
    points.push(
      `customers often needed a follow-up round before things landed (avg ${avgRounds.toFixed(1)} rounds) -- that back-and-forth felt slower than it should`,
    );
  }
  if (!isManager && escalationRate > 0) {
    points.push(
      `${Math.round(escalationRate * 100)}% of tickets needed a manager to step in, which shouldn't be the norm for routine work`,
    );
  }
  if (exceptionRate > 0) {
    points.push(
      `${Math.round(exceptionRate * 100)}% had no matching knowledge article, so it took a one-off exception instead of reusable documentation`,
    );
  }
  if (points.length === 0) {
    points.push(
      isManager
        ? "every ticket that reached me was already escalated, but each one resolved cleanly once I stepped in"
        : "most tickets closed on the first reply -- that part felt smooth and intuitive",
    );
  }

  return `${g.label}: ${points.join("; ")}.`;
}

export function buildCustomerDiscussionLine(g: GroupStats): string {
  const dissatisfiedRate = rate(g.count - g.satisfiedCount, g.count);
  const escalationRate = rate(g.escalatedCount, g.count);
  const avgRounds = g.totalRounds / g.count;
  const points: string[] = [];

  if (avgRounds >= 0.34) {
    points.push(
      `had to go back and forth more than once before the reply actually addressed it (avg ${avgRounds.toFixed(1)} rounds)`,
    );
  }
  if (escalationRate > 0) {
    points.push(
      `${Math.round(escalationRate * 100)}% of the time needed a manager before it got resolved -- more steps than expected`,
    );
  }
  if (dissatisfiedRate > 0) {
    points.push(
      `${Math.round(dissatisfiedRate * 100)}% of "resolved" tickets came back again -- the fix didn't always stick`,
    );
  }
  if (points.length === 0) {
    points.push("submitting a ticket and getting a fix was quick and easy -- no complaints");
  }

  return `${g.label}: ${points.join("; ")}.`;
}

export function buildTeamDiscussion(records: TicketRunRecord[]): string {
  if (records.length === 0) return "No tickets were simulated -- nothing to discuss.";

  const lines: string[] = ["\n=== Team retro: what felt easy, what didn't ==="];

  lines.push("\nStaff:");
  for (const g of summarizeByStaff(records)) lines.push(`  ${buildStaffDiscussionLine(g)}`);

  lines.push("\nCustomers:");
  for (const g of summarizeByCustomer(records)) lines.push(`  ${buildCustomerDiscussionLine(g)}`);

  return lines.join("\n");
}
