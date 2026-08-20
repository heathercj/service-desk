import { describe, expect, it } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows requests up to the max within a window", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, { windowMs: 60_000, max: 5 }).allowed).toBe(true);
    }
  });

  it("blocks requests once the max is exceeded", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(key, { windowMs: 60_000, max: 5 });
    const result = checkRateLimit(key, { windowMs: 60_000, max: 5 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const keyA = `a-${Math.random()}`;
    const keyB = `b-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(keyA, { windowMs: 60_000, max: 5 });
    expect(checkRateLimit(keyA, { windowMs: 60_000, max: 5 }).allowed).toBe(false);
    expect(checkRateLimit(keyB, { windowMs: 60_000, max: 5 }).allowed).toBe(true);
  });

  it("resets the window after it elapses", async () => {
    const key = `reset-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, { windowMs: 20, max: 3 });
    expect(checkRateLimit(key, { windowMs: 20, max: 3 }).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(checkRateLimit(key, { windowMs: 20, max: 3 }).allowed).toBe(true);
  });
});
