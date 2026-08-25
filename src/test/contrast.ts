/**
 * WCAG contrast maths for the APEX colour tokens.
 *
 * The tokens are stored as bare oklch components (see the comment at the top
 * of `src/app/globals.css`), so checking a pair means oklch -> linear sRGB ->
 * gamma-encoded sRGB -> WCAG relative luminance. Verified against axe-core:
 * amber-600 under near-white reports 3.06 here and 3.07 in axe.
 */

/** Converts oklch components to linear-light sRGB, clamped to gamut. */
function oklchToLinearSrgb(
  L: number,
  C: number,
  hueDegrees: number,
): [number, number, number] {
  const h = (hueDegrees * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // OKLab -> LMS (cube of the intermediate values), then LMS -> linear sRGB.
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}

/** sRGB transfer function, linear-light -> encoded. */
function encodeGamma(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** sRGB transfer function, encoded -> linear-light. */
function decodeGamma(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Parses a token value into WCAG relative luminance. Accepts both token
 * shapes: bare components (`0.666 0.179 58.318`) and a complete colour
 * (`oklch(0.92 0.004 286.32)`). Alpha is not supported -- a translucent
 * token has no fixed contrast, so callers must not pass one.
 */
export function luminanceOfToken(value: string): number {
  const numbers = value
    .replace(/oklch|[(),]/g, " ")
    .trim()
    .split(/\s+/);
  if (numbers.some((part) => part.includes("%") || part === "/")) {
    throw new Error(`Cannot measure contrast of a translucent token: ${value}`);
  }
  const [L, C, h] = numbers.map(Number);
  if ([L, C, h].some((part) => part === undefined || Number.isNaN(part))) {
    throw new Error(`Unparseable oklch token: ${value}`);
  }
  const encoded = oklchToLinearSrgb(L as number, C as number, h as number).map(
    encodeGamma,
  );
  const [r, g, b] = encoded.map((channel) =>
    decodeGamma(Math.min(1, Math.max(0, channel))),
  );
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** WCAG 2.1 contrast ratio between two oklch token values. */
export function contrastRatio(oneToken: string, otherToken: string): number {
  const a = luminanceOfToken(oneToken);
  const b = luminanceOfToken(otherToken);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.1 AA for normal-size text. Small text is the case that bites. */
export const AA_NORMAL_TEXT = 4.5;

/**
 * WCAG 2.1 AA for non-text contrast (1.4.11) -- the bar a focus indicator has
 * to clear against the surface it is drawn on. Lower than the text bar, but a
 * ring that misses it is exactly the "I cannot see where I am" complaint.
 */
export const AA_NON_TEXT = 3;
