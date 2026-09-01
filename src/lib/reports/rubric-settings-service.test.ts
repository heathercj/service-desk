import { describe, expect, it } from "vitest";
import { DEFAULT_RUBRIC, parseRubric } from "./rubric-settings-service";

describe("parseRubric", () => {
  it("returns the parsed value when it matches the rubric shape", () => {
    const value = {
      targetHoursByPriority: { URGENT: 4, HIGH: 12, MEDIUM: 48, LOW: 96 },
      graceHours: 24,
    };
    expect(parseRubric(value)).toEqual(value);
  });

  it("falls back to the default when the stored value is undefined (no AppSetting row yet)", () => {
    expect(parseRubric(undefined)).toEqual(DEFAULT_RUBRIC);
  });

  it("falls back to the default when the stored JSON is missing a priority tier", () => {
    const malformed = {
      targetHoursByPriority: { URGENT: 4, HIGH: 12, MEDIUM: 48 }, // LOW missing
      graceHours: 24,
    };
    expect(parseRubric(malformed)).toEqual(DEFAULT_RUBRIC);
  });

  it("falls back to the default when an hour value is not positive", () => {
    const malformed = {
      targetHoursByPriority: { URGENT: 0, HIGH: 12, MEDIUM: 48, LOW: 96 },
      graceHours: 24,
    };
    expect(parseRubric(malformed)).toEqual(DEFAULT_RUBRIC);
  });

  it("falls back to the default when the value is a completely different shape", () => {
    expect(parseRubric("not an object")).toEqual(DEFAULT_RUBRIC);
    expect(parseRubric(null)).toEqual(DEFAULT_RUBRIC);
    expect(parseRubric([1, 2, 3])).toEqual(DEFAULT_RUBRIC);
  });

  it("has the agreed starting values as the default", () => {
    expect(DEFAULT_RUBRIC).toEqual({
      targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72, LOW: 120 },
      graceHours: 72,
    });
  });
});
