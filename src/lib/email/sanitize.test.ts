import { describe, expect, it } from "vitest";
import {
  assertNoHeaderInjection,
  sanitizeEmailSubject,
  sanitizePlainTextBody,
  UnsafeEmailValueError,
} from "./sanitize";

describe("assertNoHeaderInjection", () => {
  it("passes clean single-line values", () => {
    expect(() => assertNoHeaderInjection("to", "person@example.com")).not.toThrow();
  });

  it("rejects CRLF header injection attempts", () => {
    expect(() =>
      assertNoHeaderInjection("to", "a@example.com\r\nBcc: evil@example.com"),
    ).toThrow(UnsafeEmailValueError);
  });

  it("rejects bare newlines", () => {
    expect(() => assertNoHeaderInjection("subject", "hello\nX-Injected: true")).toThrow(
      UnsafeEmailValueError,
    );
  });
});

describe("sanitizeEmailSubject", () => {
  it("collapses embedded line breaks instead of allowing header injection", () => {
    expect(sanitizeEmailSubject("Hi\r\nBcc: evil@example.com")).not.toMatch(/[\r\n]/);
  });

  it("truncates very long subjects", () => {
    expect(sanitizeEmailSubject("a".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe("sanitizePlainTextBody", () => {
  it("keeps normal text, tabs, and newlines", () => {
    expect(sanitizePlainTextBody("Line one\n\tindented line two")).toBe(
      "Line one\n\tindented line two",
    );
  });

  it("strips other control characters", () => {
    const withControlChar = `before${String.fromCharCode(7)}after`;
    expect(sanitizePlainTextBody(withControlChar)).toBe("beforeafter");
  });
});
