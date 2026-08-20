/**
 * Email header/body sanitization (Section 9, 15, 17). Header injection is
 * prevented by rejecting CR/LF in any value that becomes a header, and
 * message bodies are plain text only in the prototype (Section 9: "Sanitize
 * HTML or use plain text" -- we chose plain text, which needs no HTML
 * sanitizer at all).
 */

export class UnsafeEmailValueError extends Error {
  constructor(field: string) {
    super(`Unsafe value for email field "${field}": contains a line break`);
    this.name = "UnsafeEmailValueError";
  }
}

export function assertNoHeaderInjection(field: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new UnsafeEmailValueError(field);
  }
}

export function sanitizeEmailSubject(subject: string): string {
  const trimmed = subject.replace(/[\r\n]+/g, " ").trim();
  return trimmed.slice(0, 200);
}

const TAB_CODE = 9;
const NEWLINE_CODE = 10;
const CONTROL_CHAR_MAX = 31;
const DEL_CODE = 127;

/** Strips control characters (keeping tab and newline) and caps length; body is always plain text. */
export function sanitizePlainTextBody(body: string): string {
  const stripped = Array.from(body)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      const isTabOrNewline = code === TAB_CODE || code === NEWLINE_CODE;
      const isControl = code <= CONTROL_CHAR_MAX || code === DEL_CODE;
      return isTabOrNewline || !isControl;
    })
    .join("");
  return stripped.slice(0, 20_000);
}
