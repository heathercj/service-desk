import { describe, expect, it } from "vitest";
import { normalizeQueryText } from "./provider";

describe("normalizeQueryText", () => {
  it("lowercases, strips punctuation, and drops stopwords", () => {
    const result = normalizeQueryText(
      "The VPN client won't connect to the office network!",
    );
    expect(result).not.toMatch(/\bthe\b/);
    expect(result).toContain("vpn");
    expect(result).toContain("client");
    expect(result).toContain("connect");
    expect(result).toContain("office");
    expect(result).toContain("network");
  });

  it("deduplicates repeated keywords", () => {
    const result = normalizeQueryText("printer printer printer jam jam");
    expect(result.split(" ").filter((w) => w === "printer")).toHaveLength(1);
  });

  it("caps the number of keywords retained", () => {
    const longText = Array.from({ length: 40 }, (_, i) => `keyword${i}`).join(" ");
    const result = normalizeQueryText(longText, 5);
    expect(result.split(" ")).toHaveLength(5);
  });

  it("never retains obviously short filler tokens", () => {
    const result = normalizeQueryText("it is up to us to go");
    expect(result.trim()).toBe("");
  });
});
