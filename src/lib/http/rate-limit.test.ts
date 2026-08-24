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

/**
 * The sign-in limit's own shape, rather than the limiter's. These lock the two
 * facts that made the full e2e suite flaky for weeks: the bucket is shared
 * whenever there is no x-forwarded-for, and twenty is the point it closes.
 * See "Known flake" in docs/TESTING.md.
 */
describe("the sign-in rate limit", () => {
  const authLimit = { windowMs: 60_000, max: 20 };

  it("closes on the twenty-first request in a window", () => {
    const key = `auth-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(key, authLimit).allowed).toBe(true);
    }
    expect(checkRateLimit(key, authLimit).allowed).toBe(false);
  });

  it("counts unrelated callers together when they share a key", () => {
    // What `auth:unknown` is: middleware falls back to that single key for
    // every request without x-forwarded-for, so callers that have nothing to
    // do with each other spend the same budget. Six Playwright workers on
    // localhost are one caller as far as this is concerned.
    const shared = `auth:unknown-${Math.random()}`;
    for (let i = 0; i < 20; i++) checkRateLimit(shared, authLimit);
    expect(checkRateLimit(shared, authLimit).allowed).toBe(false);
  });
});
