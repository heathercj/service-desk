import { describe, expect, it } from "vitest";
import { articleRelativePath } from "./markdown-repo";
import { departmentKeyToFolder, folderToDepartmentKey } from "./department-folders";

describe("articleRelativePath", () => {
  it("builds a predictable department/slug path", () => {
    const p = articleRelativePath("TECHNOLOGY_SUPPORT", "reset-vpn-client");
    expect(p.replace(/\\/g, "/")).toBe("technology-support/reset-vpn-client.md");
  });

  it("rejects a slug attempting path traversal", () => {
    expect(() => articleRelativePath("TECHNOLOGY_SUPPORT", "../../etc/passwd")).toThrow();
  });

  it("rejects a slug with a path separator", () => {
    expect(() => articleRelativePath("TECHNOLOGY_SUPPORT", "foo/bar")).toThrow();
  });

  it("does not itself gate on whether a department is real -- that's requireActiveDepartment's job (createDraftArticle calls it first)", () => {
    expect(articleRelativePath("FINANCE", "some-slug").replace(/\\/g, "/")).toBe(
      "finance/some-slug.md",
    );
  });
});

describe("department folder mapping", () => {
  it("round-trips department key <-> folder name", () => {
    expect(departmentKeyToFolder("LEGAL")).toBe("legal");
    expect(folderToDepartmentKey("legal")).toBe("LEGAL");
  });

  it("round-trips a department with no hand-maintained folder entry (regression: this used to throw)", () => {
    expect(departmentKeyToFolder("IMPROVEMENT_IDEAS")).toBe("improvement-ideas");
    expect(folderToDepartmentKey("improvement-ideas")).toBe("IMPROVEMENT_IDEAS");
  });
});
