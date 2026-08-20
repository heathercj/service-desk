import { describe, expect, it } from "vitest";
import { redactValue } from "./audit-log";

describe("redactValue", () => {
  it("redacts obviously sensitive keys at the top level", () => {
    const result = redactValue({ password: "hunter2", note: "fine" }) as Record<
      string,
      unknown
    >;
    expect(result.password).toBe("[redacted]");
    expect(result.note).toBe("fine");
  });

  it("redacts sensitive keys nested inside objects", () => {
    const result = redactValue({
      user: { email: "a@b.com", apiKey: "sk-123" },
    }) as { user: Record<string, unknown> };
    expect(result.user.apiKey).toBe("[redacted]");
    expect(result.user.email).toBe("a@b.com");
  });

  it("redacts sensitive keys inside arrays of objects", () => {
    const result = redactValue([{ token: "abc" }, { note: "ok" }]) as Record<
      string,
      unknown
    >[];
    expect(result[0]?.token).toBe("[redacted]");
    expect(result[1]?.note).toBe("ok");
  });

  it("matches case-insensitively and across common variants", () => {
    const result = redactValue({
      Authorization: "Bearer x",
      credit_card: "4111",
      creditCard: "4111",
      ssn: "123-45-6789",
    }) as Record<string, unknown>;
    expect(result.Authorization).toBe("[redacted]");
    expect(result.ssn).toBe("[redacted]");
  });

  it("passes through primitives and null unchanged", () => {
    expect(redactValue(null)).toBeNull();
    expect(redactValue(42)).toBe(42);
    expect(redactValue("hello")).toBe("hello");
  });
});
