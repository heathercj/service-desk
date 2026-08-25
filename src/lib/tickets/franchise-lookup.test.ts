import { describe, expect, it } from "vitest";
import { matchFranchiseForDepartment } from "./franchise-lookup";

const FRANCHISES = [
  { id: "van-id", name: "Alair Homes Vancouver", code: "VAN" },
  { id: "cal-id", name: "Alair Homes Calgary", code: "CAL" },
  { id: "hq-id", name: "Head Office / Unassigned", code: "HQ" },
];

describe("matchFranchiseForDepartment", () => {
  it("matches by franchise name, case-insensitively", () => {
    expect(matchFranchiseForDepartment("alair homes vancouver", FRANCHISES)).toBe(
      "van-id",
    );
  });

  it("matches by franchise code, case-insensitively", () => {
    expect(matchFranchiseForDepartment("cal", FRANCHISES)).toBe("cal-id");
  });

  it("tolerates surrounding whitespace", () => {
    expect(matchFranchiseForDepartment("  VAN  ", FRANCHISES)).toBe("van-id");
  });

  it("returns null when nothing matches", () => {
    expect(matchFranchiseForDepartment("Winnipeg", FRANCHISES)).toBeNull();
  });

  it("returns null for an empty or missing department value", () => {
    expect(matchFranchiseForDepartment(null, FRANCHISES)).toBeNull();
    expect(matchFranchiseForDepartment("", FRANCHISES)).toBeNull();
    expect(matchFranchiseForDepartment("   ", FRANCHISES)).toBeNull();
  });
});
