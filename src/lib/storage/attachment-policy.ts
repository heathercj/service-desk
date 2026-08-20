import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";

/**
 * Attachment policy (Section 6, 14): count/size/type limits, magic-byte
 * detection instead of trusting the filename or browser-supplied MIME
 * type, randomized storage names, and a hard block-list for
 * executable/active-content formats even if a future allow-list entry
 * would otherwise match.
 */

export const MAX_ATTACHMENTS_PER_TICKET = 8;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_AGGREGATE_BYTES = 50 * 1024 * 1024; // 50 MiB
export const MAX_FILENAME_LENGTH = 200;

/**
 * Allow-list of (extension, magic-byte-detected MIME) pairs. HTML and SVG
 * are intentionally excluded: Section 6 requires that uploaded HTML/SVG
 * never be rendered inline, and the simplest way to guarantee that is to
 * not accept them as attachments in the prototype.
 */
const ALLOWED_TYPES: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "log"],
};

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "msi",
  "ps1",
  "sh",
  "js",
  "vbs",
  "wsf",
  "jar",
  "app",
  "scr",
  "svg",
  "html",
  "htm",
  "xhtml",
  "swf",
]);

export interface AttachmentCheckInput {
  originalFilename: string;
  declaredContentType: string;
  sizeBytes: number;
  buffer: Buffer;
}

export interface AttachmentCheckResult {
  ok: boolean;
  reason?: string;
  detectedContentType?: string;
  storedFilename?: string;
  checksumSha256?: string;
}

export async function checkAttachment(
  input: AttachmentCheckInput,
  currentAggregateBytes = 0,
): Promise<AttachmentCheckResult> {
  const filename = input.originalFilename.trim();

  if (!filename) return { ok: false, reason: "Filename is required" };
  if (filename.length > MAX_FILENAME_LENGTH)
    return { ok: false, reason: "Filename is too long" };
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return { ok: false, reason: "Filename contains unsafe path characters" };
  }

  const ext = path.extname(filename).slice(1).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `File type ".${ext}" is not permitted` };
  }

  if (input.sizeBytes <= 0) return { ok: false, reason: "File is empty" };
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `File exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB limit`,
    };
  }
  if (currentAggregateBytes + input.sizeBytes > MAX_AGGREGATE_BYTES) {
    return {
      ok: false,
      reason: "Aggregate attachment size limit exceeded for this ticket",
    };
  }

  const uint8 = new Uint8Array(
    input.buffer.buffer,
    input.buffer.byteOffset,
    input.buffer.byteLength,
  );
  const detected = await fileTypeFromBuffer(uint8);
  const detectedMime = detected?.mime;

  // Plain text has no reliable magic bytes; fall back to the declared type
  // ONLY for the text/plain allow-list entry, and only if the buffer looks
  // like text (no NUL bytes in the first chunk).
  const looksLikeText = !input.buffer.subarray(0, 512).includes(0);
  const effectiveMime =
    detectedMime ??
    (looksLikeText && input.declaredContentType === "text/plain"
      ? "text/plain"
      : undefined);

  if (!effectiveMime || !ALLOWED_TYPES[effectiveMime]) {
    return {
      ok: false,
      reason: "File content does not match an allowed, verified file type",
    };
  }

  const allowedExts = ALLOWED_TYPES[effectiveMime] ?? [];
  if (ext && !allowedExts.includes(ext)) {
    return {
      ok: false,
      reason: "File extension does not match its detected content type",
    };
  }

  const checksumSha256 = createHash("sha256").update(input.buffer).digest("hex");
  const storedFilename = `${randomUUID()}${ext ? `.${ext}` : ""}`;

  return { ok: true, detectedContentType: effectiveMime, storedFilename, checksumSha256 };
}
