/**
 * Resolution gate (Section 11.3): a ticket may not become RESOLVED unless
 * every one of these is true. Pure/testable -- the ticket service supplies
 * the facts, this module only judges them, so the rule set can be unit
 * tested without a database.
 */

export interface ResolutionGateInput {
  resolutionSummary: string | null;
  resolutionSteps: string | null;
  /** True once a similarity check has run at/after the latest resolution edit. */
  hasCurrentKnowledgeCheck: boolean;
  /** The recorded outcome for this ticket, if any, and whether it is still current. */
  knowledgeOutcome: {
    type: "LINKED_EXISTING" | "PROPOSED_UPDATE" | "NEW_DRAFT" | "EXCEPTION";
    isCurrent: boolean;
  } | null;
}

export interface ResolutionGateResult {
  ok: boolean;
  blockingReasons: string[];
}

const MIN_SUMMARY_LENGTH = 10;
const MIN_STEPS_LENGTH = 10;

export function evaluateResolutionGate(input: ResolutionGateInput): ResolutionGateResult {
  const blockingReasons: string[] = [];

  if (
    !input.resolutionSummary ||
    input.resolutionSummary.trim().length < MIN_SUMMARY_LENGTH
  ) {
    blockingReasons.push("A resolution summary has not been entered.");
  }
  if (!input.resolutionSteps || input.resolutionSteps.trim().length < MIN_STEPS_LENGTH) {
    blockingReasons.push("Resolution steps have not been entered.");
  }
  if (!input.hasCurrentKnowledgeCheck) {
    blockingReasons.push(
      "A knowledge similarity check has not been completed since the latest resolution edit.",
    );
  }
  if (!input.knowledgeOutcome) {
    blockingReasons.push(
      "No knowledge outcome is recorded (link an article, propose an update, draft a new article, or record an approved exception).",
    );
  } else if (!input.knowledgeOutcome.isCurrent) {
    blockingReasons.push(
      "The recorded knowledge outcome is no longer current for this resolution.",
    );
  }

  return { ok: blockingReasons.length === 0, blockingReasons };
}
