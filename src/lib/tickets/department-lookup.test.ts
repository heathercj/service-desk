import { describe, expect, it } from "vitest";
import { slugifyDepartmentKey } from "./department-lookup";

describe("slugifyDepartmentKey", () => {
  it("uppercases and joins words with underscores", () => {
    expect(slugifyDepartmentKey("Alair Performance Team")).toBe("ALAIR_PERFORMANCE_TEAM");
  });

  it("strips diacritics before matching, rather than dropping the letters", () => {
    expect(slugifyDepartmentKey("Équipe Performance")).toBe("EQUIPE_PERFORMANCE");
  });

  it("collapses runs of punctuation/whitespace into a single underscore", () => {
    expect(slugifyDepartmentKey("Sales & Marketing  --  EMEA")).toBe(
      "SALES_MARKETING_EMEA",
    );
  });

  it("trims leading and trailing underscores", () => {
    expect(slugifyDepartmentKey("  -Legal-  ")).toBe("LEGAL");
  });

  it("leaves an already-valid key unchanged", () => {
    expect(slugifyDepartmentKey("TECHNOLOGY_SUPPORT")).toBe("TECHNOLOGY_SUPPORT");
  });

  it("returns an empty string for a name with no letters or digits", () => {
    expect(slugifyDepartmentKey("!!! ---")).toBe("");
    expect(slugifyDepartmentKey("🎉🎉🎉")).toBe("");
  });

  it("truncates a very long name to a bounded key", () => {
    const longName = "A".repeat(100);
    expect(slugifyDepartmentKey(longName).length).toBeLessThanOrEqual(80);
  });
});
