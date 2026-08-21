/**
 * Aggregate feedback scorecard across a sim-run.ts batch. Pure/no I/O, same
 * as response-engine.ts -- just groups the per-ticket outcomes recorded
 * during the run and formats them as text.
 */
export interface TicketRunRecord {
  customerKey: string;
  customerDisplayName: string;
  resolvingPersonaKey: string;
  resolvingPersonaDisplayName: string;
  /** Customer follow-up rounds before the ticket was escalated or resolved. */
  rounds: number;
  escalated: boolean;
  knowledgeOutcomeType: "LINKED_EXISTING" | "EXCEPTION";
  reopened: boolean;
  finalStatus: string;
}

interface GroupStats {
  label: string;
  count: number;
  satisfiedCount: number;
  escalatedCount: number;
  exceptionCount: number;
  totalRounds: number;
}

function groupBy(
  records: TicketRunRecord[],
  keyOf: (r: TicketRunRecord) => string,
  labelOf: (r: TicketRunRecord) => string,
): GroupStats[] {
  const groups = new Map<string, GroupStats>();
  for (const r of records) {
    const key = keyOf(r);
    let group = groups.get(key);
    if (!group) {
      group = {
        label: labelOf(r),
        count: 0,
        satisfiedCount: 0,
        escalatedCount: 0,
        exceptionCount: 0,
        totalRounds: 0,
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (r.finalStatus !== "REOPENED") group.satisfiedCount += 1;
    if (r.escalated) group.escalatedCount += 1;
    if (r.knowledgeOutcomeType === "EXCEPTION") group.exceptionCount += 1;
    group.totalRounds += r.rounds;
  }
  return [...groups.values()];
}

function pct(count: number, total: number): string {
  return total === 0 ? "n/a" : `${Math.round((count / total) * 100)}%`;
}

function formatGroup(group: GroupStats): string {
  const avgRounds = (group.totalRounds / group.count).toFixed(1);
  return (
    `  ${group.label.padEnd(34)} tickets=${group.count}  satisfied=${pct(group.satisfiedCount, group.count)}  ` +
    `avg follow-up rounds=${avgRounds}  escalated=${pct(group.escalatedCount, group.count)}  ` +
    `knowledge-exception=${pct(group.exceptionCount, group.count)}`
  );
}

export function buildScorecard(records: TicketRunRecord[]): string {
  if (records.length === 0) return "No tickets were simulated.";

  const lines: string[] = [];

  lines.push("\n=== Customer feedback scorecard ===");
  const byCustomer = groupBy(
    records,
    (r) => r.customerKey,
    (r) => r.customerDisplayName,
  ).sort((a, b) => a.label.localeCompare(b.label));
  for (const g of byCustomer) lines.push(formatGroup(g));

  lines.push("\n=== Staff feedback scorecard ===");
  const byStaff = groupBy(
    records,
    (r) => r.resolvingPersonaKey,
    (r) => r.resolvingPersonaDisplayName,
  ).sort((a, b) => a.label.localeCompare(b.label));
  for (const g of byStaff) lines.push(formatGroup(g));

  lines.push("\n=== Overall ===");
  const [overall] = groupBy(
    records,
    () => "overall",
    () => "All tickets",
  );
  if (overall) lines.push(formatGroup(overall));

  return lines.join("\n");
}
