/**
 * URL safety validation (Section 6, 15). Tickets carry user-submitted URLs
 * that the app must NEVER fetch server-side (SSRF, Section 15) and must
 * only ever render as an inert, clearly-labelled external link.
 */

const ALWAYS_ALLOWED_SCHEMES = new Set(["https:"]);
const DEV_ONLY_ALLOWED_SCHEMES = new Set(["http:"]);

export const MAX_URL_LENGTH = 2048;
export const MAX_URLS_PER_TICKET = 10;

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
  hostname?: string;
  normalized?: string;
}

export function validateSubmittedUrl(
  rawUrl: string,
  opts: { allowHttp?: boolean } = {},
): UrlSafetyResult {
  const value = rawUrl.trim();

  if (!value) return { ok: false, reason: "URL is empty" };
  if (value.length > MAX_URL_LENGTH)
    return { ok: false, reason: "URL exceeds maximum length" };

  // Reject credential-bearing URLs before parsing, since some obviously
  // dangerous forms (e.g. "javascript:alert(1)//@evil") can otherwise parse
  // "successfully" in permissive URL parsers.
  if (/^\s*(javascript|data|file|vbscript|blob):/i.test(value)) {
    return { ok: false, reason: "Unsafe URL scheme" };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "URL is not well-formed" };
  }

  const allowedSchemes = new Set(ALWAYS_ALLOWED_SCHEMES);
  if (opts.allowHttp) {
    for (const s of DEV_ONLY_ALLOWED_SCHEMES) allowedSchemes.add(s);
  }

  if (!allowedSchemes.has(parsed.protocol)) {
    return { ok: false, reason: `Scheme "${parsed.protocol}" is not permitted` };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "URLs must not embed credentials" };
  }

  if (!parsed.hostname) {
    return { ok: false, reason: "URL is missing a hostname" };
  }

  return { ok: true, hostname: parsed.hostname, normalized: parsed.toString() };
}

export function validateSubmittedUrls(
  rawUrls: string[],
  opts: { allowHttp?: boolean } = {},
): { ok: boolean; errors: string[]; results: UrlSafetyResult[] } {
  if (rawUrls.length > MAX_URLS_PER_TICKET) {
    return {
      ok: false,
      errors: [`No more than ${MAX_URLS_PER_TICKET} URLs are allowed`],
      results: [],
    };
  }
  const results = rawUrls.map((u) => validateSubmittedUrl(u, opts));
  const errors = results.filter((r) => !r.ok).map((r) => r.reason ?? "Invalid URL");
  return { ok: errors.length === 0, errors, results };
}
