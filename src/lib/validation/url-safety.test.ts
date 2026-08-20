import { describe, expect, it } from "vitest";
import { validateSubmittedUrl, validateSubmittedUrls } from "./url-safety";

describe("validateSubmittedUrl", () => {
  it("accepts a plain https URL", () => {
    const result = validateSubmittedUrl("https://example.com/issue/42");
    expect(result.ok).toBe(true);
    expect(result.hostname).toBe("example.com");
  });

  it("rejects http in production-like mode by default", () => {
    expect(validateSubmittedUrl("http://example.com").ok).toBe(false);
  });

  it("allows http only when explicitly enabled for local dev", () => {
    expect(validateSubmittedUrl("http://localhost:3000", { allowHttp: true }).ok).toBe(
      true,
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
  ])("rejects unsafe scheme: %s", (url) => {
    expect(validateSubmittedUrl(url).ok).toBe(false);
  });

  it("rejects credential-bearing URLs", () => {
    expect(validateSubmittedUrl("https://user:pass@example.com").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateSubmittedUrl("not a url").ok).toBe(false);
  });

  it("rejects empty or oversized input", () => {
    expect(validateSubmittedUrl("").ok).toBe(false);
    expect(validateSubmittedUrl(`https://example.com/${"a".repeat(3000)}`).ok).toBe(
      false,
    );
  });
});

describe("validateSubmittedUrls", () => {
  it("rejects more than the maximum number of URLs", () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    const result = validateSubmittedUrls(urls);
    expect(result.ok).toBe(false);
  });

  it("collects per-URL errors", () => {
    const result = validateSubmittedUrls(["https://example.com", "javascript:evil()"]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
