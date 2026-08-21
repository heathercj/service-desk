import type { AgentPersona } from "./agent-personas";
import type { CustomerPersona, TicketScenario } from "./customer-personas";
import type { TicketRunRecord } from "./scorecard";

/**
 * Pure, deterministic simulation logic -- no database/network access. Mirrors
 * the "no external AI call" philosophy of src/lib/ai/local-provider.ts:
 * every "AI persona" reply here is a template parameterized by the persona's
 * own skill list, not a model call.
 */

export type Rng = () => number;

/** mulberry32 -- small, fast, deterministic PRNG for reproducible sim runs. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickScenario(customer: CustomerPersona, rng: Rng): TicketScenario {
  const index = Math.min(
    Math.floor(rng() * customer.scenarios.length),
    customer.scenarios.length - 1,
  );
  const scenario = customer.scenarios[index];
  if (!scenario) throw new Error(`Persona "${customer.key}" has no scenarios`);
  return scenario;
}

export function buildDiagnosticNote(agent: AgentPersona, scenario: TicketScenario): string {
  const [primarySkill, secondarySkill] = agent.skills;
  return (
    `Reviewed via ${primarySkill}. Checked "${scenario.category}" against known ` +
    `symptoms for ${scenario.departmentKey.replace(/_/g, " ").toLowerCase()} tickets` +
    (secondarySkill ? ` before applying ${secondarySkill}.` : ".")
  );
}

export function buildResolutionMessage(agent: AgentPersona, scenario: TicketScenario): string {
  const skill = agent.skills[0];
  return (
    `Hi, thanks for the details. Drawing on our ${skill}, here's what I found for ` +
    `"${scenario.subject}" and the steps to resolve it. Please try this and let me ` +
    `know if it's fixed or you're still seeing the issue.`
  );
}

export function buildEscalationNote(manager: AgentPersona, scenario: TicketScenario): string {
  return (
    `Picking this up from the queue given the customer's follow-up on "${scenario.subject}". ` +
    `Applying ${manager.skills[manager.skills.length - 1]} to unblock this.`
  );
}

export function buildEscalationMessage(manager: AgentPersona): string {
  return (
    `Hi, I'm ${manager.displayName} -- I've taken over this ticket to make sure it's ` +
    `resolved properly. Reviewing now and I'll follow up shortly with next steps.`
  );
}

export function buildCustomerFollowUp(customer: CustomerPersona, round: number): string {
  const base =
    round === 1
      ? "Thanks, I tried that but I'm still running into the same problem."
      : "Still not working on my end -- can we try something else?";
  if (customer.skills.includes("very low system familiarity")) {
    return `${base} Sorry, I'm still new to all this so let me know exactly what to click.`;
  }
  if (customer.skills.includes("low tech literacy")) {
    return `${base} not sure what else to try here`;
  }
  return base;
}

export function buildReopenReason(customer: CustomerPersona, scenario: TicketScenario): string {
  return `Customer reports the issue with "${scenario.subject}" has recurred after the ticket was marked resolved.`;
}

export type CustomerOutcome = "satisfied" | "follow_up" | "escalate";

export function decideOutcome(
  customer: CustomerPersona,
  rng: Rng,
  round: number,
): CustomerOutcome {
  if (rng() < customer.behavior.patience) return "satisfied";
  const wantsEscalation = rng() < customer.behavior.escalationThreshold;
  if (wantsEscalation) return "escalate";
  return round >= 2 ? "satisfied" : "follow_up";
}

export function decideReopen(customer: CustomerPersona, rng: Rng): boolean {
  return rng() < customer.behavior.escalationThreshold * 0.5;
}

type ReflectionRecord = Pick<
  TicketRunRecord,
  "rounds" | "escalated" | "knowledgeOutcomeType" | "reopened"
>;

/** Customer's own reflection on the experience -- derived from what actually happened, not free-form opinion. */
export function buildCustomerReflection(
  customer: CustomerPersona,
  record: ReflectionRecord,
): string {
  if (record.reopened) {
    return `[reflection] ${customer.displayName}: This didn't actually stick -- I'm having to raise it again, which isn't what I expect.`;
  }
  if (record.escalated) {
    return `[reflection] ${customer.displayName}: Glad it got sorted, but it shouldn't have needed a manager to step in for something like this.`;
  }
  if (record.rounds > 0) {
    return `[reflection] ${customer.displayName}: Took a couple of tries to land, but we got there in the end.`;
  }
  return `[reflection] ${customer.displayName}: Fixed on the first reply -- exactly what I needed.`;
}

/** Resolving staff persona's reflection -- surfaces process friction (escalation, missing KB coverage), not customer sentiment. */
export function buildStaffReflection(persona: AgentPersona, record: ReflectionRecord): string {
  if (record.escalated) {
    return `[reflection] ${persona.displayName}: This one needed escalation -- more friction than a routine ticket in this department should require.`;
  }
  if (record.knowledgeOutcomeType === "EXCEPTION") {
    return `[reflection] ${persona.displayName}: Resolved it, but we still don't have a knowledge article covering this -- worth drafting one so the next agent doesn't start from scratch.`;
  }
  if (record.rounds > 0) {
    return `[reflection] ${persona.displayName}: Needed a follow-up round before it landed, but ${persona.skills[0]} got us there.`;
  }
  return `[reflection] ${persona.displayName}: Straightforward -- resolved on the first reply using ${persona.skills[0]}.`;
}
