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

  it("rejects an unknown department key", () => {
    expect(() => articleRelativePath("FINANCE", "some-slug")).toThrow();
  });
});

describe("department folder mapping", () => {
  it("round-trips department key <-> folder name", () => {
    expect(departmentKeyToFolder("LEGAL")).toBe("legal");
    expect(folderToDepartmentKey("legal")).toBe("LEGAL");
  });
});
