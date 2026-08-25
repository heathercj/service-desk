import { describe, expect, it } from "vitest";
import { suggestDepartment } from "./department-suggestion";

describe("suggestDepartment", () => {
  it("suggests Technology Support for a VPN issue", () => {
    const result = suggestDepartment(
      "Cannot connect",
      "My VPN keeps dropping and I can't log in to email",
    );
    expect(result?.departmentKey).toBe("TECHNOLOGY_SUPPORT");
  });

  it("suggests Accounting Services for an invoice issue", () => {
    const result = suggestDepartment(
      "Invoice question",
      "The payment on this invoice looks wrong, please review billing",
    );
    expect(result?.departmentKey).toBe("ACCOUNTING_SERVICES");
  });

  it("suggests Legal for a contract issue", () => {
    const result = suggestDepartment(
      "Contract review",
      "Need help with a vendor agreement and compliance question",
    );
    expect(result?.departmentKey).toBe("LEGAL");
  });

  it("suggests Improvement Ideas for a feature request", () => {
    const result = suggestDepartment(
      "A suggestion",
      "I have an idea that could improve how we handle onboarding paperwork",
    );
    expect(result?.departmentKey).toBe("IMPROVEMENT_IDEAS");
  });

  it("returns null when no keywords match", () => {
    const result = suggestDepartment("Hello", "Just saying hi, nothing specific here");
    expect(result).toBeNull();
  });

  it("picks the department with the most keyword matches", () => {
    const result = suggestDepartment(
      "Training question",
      "I need a course but also have a laptop error and password issue and login problem",
    );
    expect(result?.departmentKey).toBe("TECHNOLOGY_SUPPORT");
  });
});
