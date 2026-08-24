/**
 * Gherkin-structured BDD helpers over plain Vitest.
 *
 * We deliberately do NOT use a .feature-file runner (vitest-cucumber et al):
 * it adds a second authoring surface and a dependency, for a project where
 * the specs are written and read by developers. Instead a scenario is one
 * `it()` whose body runs labelled Given/When/Then steps, so:
 *
 *   - test output reads as behaviour, not as function names;
 *   - a failure names the step that broke, not just the assertion;
 *   - steps stay ordinary TypeScript, refactorable and type-checked.
 *
 * Usage:
 *
 *   feature("Ticket triage", () => {
 *     scenario("Agent claims an untriaged ticket", async (s) => {
 *       const ticket = await s.given("an untriaged ticket in the IT queue",
 *         () => makeTicket({ status: "QUEUED" }));
 *       const res = await s.when("the agent claims it",
 *         () => selfAssignTicket(agent, { ticketId: ticket.id }));
 *       await s.then("the ticket is assigned to that agent",
 *         () => expect(res.assigneeId).toBe(agent.userId));
 *     });
 *   });
 */
import { describe, it } from "vitest";

/** Marks which Gherkin keyword a step was declared with. */
export type StepKeyword = "Given" | "When" | "Then" | "And";

export interface StepRunner {
  given<T>(description: string, body?: () => T | Promise<T>): Promise<T>;
  when<T>(description: string, body?: () => T | Promise<T>): Promise<T>;
  then<T>(description: string, body?: () => T | Promise<T>): Promise<T>;
  and<T>(description: string, body?: () => T | Promise<T>): Promise<T>;
  /** Steps executed so far, in order -- useful for debugging a long scenario. */
  readonly trace: readonly string[];
}

/**
 * Wraps a step body so a failure inside it is reported as
 * `Then the ticket is assigned: expected 'a' to be 'b'`, keeping the
 * original stack. Steps with no body are documentation-only (a `Given`
 * describing fixture state established elsewhere).
 */
function runStep(trace: string[], keyword: StepKeyword) {
  return async <T>(description: string, body?: () => T | Promise<T>): Promise<T> => {
    const label = `${keyword} ${description}`;
    trace.push(label);
    if (!body) return undefined as T;
    try {
      return await body();
    } catch (err) {
      if (err instanceof Error) {
        err.message = `${label}\n  -> ${err.message}`;
        throw err;
      }
      throw new Error(`${label}\n  -> ${String(err)}`);
    }
  };
}

function createStepRunner(): StepRunner {
  const trace: string[] = [];
  return {
    given: runStep(trace, "Given"),
    when: runStep(trace, "When"),
    then: runStep(trace, "Then"),
    and: runStep(trace, "And"),
    trace,
  };
}

/** A Gherkin Feature -- the unit of app functionality under test. */
export function feature(name: string, body: () => void): void {
  describe(`Feature: ${name}`, body);
}

/**
 * Groups scenarios that share a precondition. Optional -- a feature may
 * hold scenarios directly.
 */
export function rule(name: string, body: () => void): void {
  describe(`Rule: ${name}`, body);
}

type ScenarioBody = (s: StepRunner) => void | Promise<void>;

interface ScenarioFn {
  (name: string, body: ScenarioBody): void;
  /** Scenario Outline: one scenario per example row. */
  each<T>(
    examples: readonly T[],
  ): (
    nameTemplate: string,
    body: (example: T, s: StepRunner) => void | Promise<void>,
  ) => void;
  skip(name: string, body: ScenarioBody): void;
  only(name: string, body: ScenarioBody): void;
}

function defineScenario(runner: typeof it | typeof it.skip | typeof it.only) {
  return (name: string, body: ScenarioBody): void => {
    runner(`Scenario: ${name}`, async () => {
      await body(createStepRunner());
    });
  };
}

export const scenario: ScenarioFn = Object.assign(defineScenario(it), {
  skip: defineScenario(it.skip),
  only: defineScenario(it.only),
  each<T>(examples: readonly T[]) {
    return (
      nameTemplate: string,
      body: (example: T, s: StepRunner) => void | Promise<void>,
    ): void => {
      it.each(examples as T[])(`Scenario: ${nameTemplate}`, async (example) => {
        await body(example, createStepRunner());
      });
    };
  },
});
