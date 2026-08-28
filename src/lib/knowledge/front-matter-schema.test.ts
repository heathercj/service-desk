import { describe, expect, it } from "vitest";
import { knowledgeFrontMatterSchema, slugify } from "./front-matter-schema";

const validFrontMatter = {
  id: "kb-0001",
  title: "How to reset your VPN client",
  slug: "how-to-reset-your-vpn-client",
  summary: "Steps to reset the VPN client when it won't connect to the office network.",
  department: "TECHNOLOGY_SUPPORT",
  status: "published",
  tags: ["vpn", "network"],
  createdDate: "2026-01-15",
  updatedDate: "2026-01-15",
  createdBy: "user-123",
  sourceTicketIds: ["ticket-1"],
  revision: 1,
};

describe("knowledgeFrontMatterSchema", () => {
  it("accepts well-formed front matter", () => {
    const result = knowledgeFrontMatterSchema.safeParse(validFrontMatter);
    expect(result.success).toBe(true);
  });

  it("rejects a slug with spaces or uppercase", () => {
    const result = knowledgeFrontMatterSchema.safeParse({
      ...validFrontMatter,
      slug: "Bad Slug",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a slug containing path separators (path traversal guard)", () => {
    const result = knowledgeFrontMatterSchema.safeParse({
      ...validFrontMatter,
      slug: "../../etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a department value that isn't shaped like a key (lowercase, spaces, hyphens)", () => {
    expect(
      knowledgeFrontMatterSchema.safeParse({ ...validFrontMatter, department: "finance" })
        .success,
    ).toBe(false);
    expect(
      knowledgeFrontMatterSchema.safeParse({
        ...validFrontMatter,
        department: "New Finance Team",
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed department value that isn't one of the original six -- membership is checked at the service layer (requireActiveDepartment), not here, since departments are created at runtime", () => {
    const result = knowledgeFrontMatterSchema.safeParse({
      ...validFrontMatter,
      department: "FINANCE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const result = knowledgeFrontMatterSchema.safeParse({
      ...validFrontMatter,
      status: "live",
    });
    expect(result.success).toBe(false);
  });

  it("requires a positive integer revision", () => {
    const result = knowledgeFrontMatterSchema.safeParse({
      ...validFrontMatter,
      revision: 0,
    });
    expect(result.success).toBe(false);
  });

  it("requires a minimum-length summary", () => {
    const result = knowledgeFrontMatterSchema.safeParse({
      ...validFrontMatter,
      summary: "too short",
    });
    expect(result.success).toBe(false);
  });
});

describe("slugify", () => {
  it("produces a lowercase, hyphenated slug", () => {
    expect(slugify("How To Reset Your VPN Client!")).toBe("how-to-reset-your-vpn-client");
  });

  it("strips characters that are not letters, numbers, or spaces", () => {
    expect(slugify("Wi-Fi & Printer (Q&A)")).toBe("wi-fi-printer-qa");
  });

  it("collapses repeated separators", () => {
    expect(slugify("too   many    spaces")).toBe("too-many-spaces");
  });
});
