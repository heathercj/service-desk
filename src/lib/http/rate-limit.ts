import "server-only";
import { env } from "@/lib/env";

/**
 * In-memory sliding-window rate limiter (Section 15: "Add rate limiting to
 * login-sensitive, ticket creation, search, chat, upload, and messaging
 * endpoints").
 *
 * Limitation, documented rather than hidden: this is per-process state. It
 * is correct for the single-instance local prototype but does NOT
 * coordinate across multiple server instances. Production deployment with
 * more than one instance needs a shared store (e.g. Redis) behind this same
 * function signature -- see docs/PRODUCTION_READINESS.md.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory growth from an unbounded key space (e.g. spoofed IPs).
const MAX_TRACKED_KEYS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(
  key: string,
  opts: { windowMs?: number; max?: number } = {},
): RateLimitResult {
  const windowMs = opts.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const max = opts.max ?? env.RATE_LIMIT_MAX_REQUESTS;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const allowed = bucket.count <= max;
  const retryAfterMs = allowed ? 0 : windowMs - (now - bucket.windowStart);
  return { allowed, remaining: Math.max(0, max - bucket.count), retryAfterMs };
}

export function rateLimitKeyFromRequest(
  req: Request,
  scope: string,
  identity?: string,
): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `${scope}:${identity ?? ip}`;
}
