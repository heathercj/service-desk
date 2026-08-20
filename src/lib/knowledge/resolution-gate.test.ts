import { describe, expect, it } from "vitest";
import { evaluateResolutionGate } from "./resolution-gate";

const baseInput = {
  resolutionSummary: "Reset the VPN client profile and re-authenticated the user.",
  resolutionSteps:
    "1. Cleared cached credentials. 2. Reinstalled the profile. 3. Verified connectivity.",
  hasCurrentKnowledgeCheck: true,
  knowledgeOutcome: { type: "LINKED_EXISTING" as const, isCurrent: true },
};

describe("evaluateResolutionGate", () => {
  it("passes when every condition is satisfied", () => {
    expect(evaluateResolutionGate(baseInput).ok).toBe(true);
  });

  it("blocks when there is no resolution summary", () => {
    const result = evaluateResolutionGate({ ...baseInput, resolutionSummary: null });
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.join(" ")).toMatch(/resolution summary/i);
  });

  it("blocks when resolution steps are too short", () => {
    const result = evaluateResolutionGate({ ...baseInput, resolutionSteps: "done" });
    expect(result.ok).toBe(false);
  });

  it("blocks when the knowledge check is stale", () => {
    const result = evaluateResolutionGate({
      ...baseInput,
      hasCurrentKnowledgeCheck: false,
    });
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.join(" ")).toMatch(/similarity check/i);
  });

  it("blocks when no knowledge outcome is recorded", () => {
    const result = evaluateResolutionGate({ ...baseInput, knowledgeOutcome: null });
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.join(" ")).toMatch(/no knowledge outcome/i);
  });

  it("blocks when the recorded outcome is no longer current", () => {
    const result = evaluateResolutionGate({
      ...baseInput,
      knowledgeOutcome: { type: "NEW_DRAFT", isCurrent: false },
    });
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.join(" ")).toMatch(/no longer current/i);
  });

  it("accepts an approved exception as a valid outcome", () => {
    const result = evaluateResolutionGate({
      ...baseInput,
      knowledgeOutcome: { type: "EXCEPTION", isCurrent: true },
    });
    expect(result.ok).toBe(true);
  });

  it("reports every blocking reason at once, not just the first", () => {
    const result = evaluateResolutionGate({
      resolutionSummary: null,
      resolutionSteps: null,
      hasCurrentKnowledgeCheck: false,
      knowledgeOutcome: null,
    });
    expect(result.blockingReasons).toHaveLength(4);
  });
});
