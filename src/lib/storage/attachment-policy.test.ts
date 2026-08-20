import { describe, expect, it } from "vitest";
import { checkAttachment, MAX_ATTACHMENT_BYTES } from "./attachment-policy";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const EXE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ..."

function pad(buf: Buffer, size = 64): Buffer {
  return Buffer.concat([buf, Buffer.alloc(size)]);
}

describe("checkAttachment", () => {
  it("accepts a genuine PNG", async () => {
    const buffer = pad(PNG_HEADER);
    const result = await checkAttachment({
      originalFilename: "screenshot.png",
      declaredContentType: "image/png",
      sizeBytes: buffer.length,
      buffer,
    });
    expect(result.ok).toBe(true);
    expect(result.detectedContentType).toBe("image/png");
    expect(result.storedFilename).toMatch(/\.png$/);
    expect(result.storedFilename).not.toContain("screenshot");
  });

  it("rejects an executable renamed with an image extension (magic-byte check)", async () => {
    const buffer = pad(EXE_HEADER);
    const result = await checkAttachment({
      originalFilename: "totally-a-photo.png",
      declaredContentType: "image/png",
      sizeBytes: buffer.length,
      buffer,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a mismatched extension for genuinely-detected content (jpeg bytes, .png name)", async () => {
    const buffer = pad(JPEG_HEADER);
    const result = await checkAttachment({
      originalFilename: "photo.png",
      declaredContentType: "image/png",
      sizeBytes: buffer.length,
      buffer,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects blocked extensions outright, even before content is checked", async () => {
    const buffer = pad(EXE_HEADER);
    const result = await checkAttachment({
      originalFilename: "installer.exe",
      declaredContentType: "application/octet-stream",
      sizeBytes: buffer.length,
      buffer,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects SVG and HTML uploads (never rendered inline per Section 6)", async () => {
    const svgBuffer = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    const result = await checkAttachment({
      originalFilename: "diagram.svg",
      declaredContentType: "image/svg+xml",
      sizeBytes: svgBuffer.length,
      buffer: svgBuffer,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects path traversal in filenames", async () => {
    const buffer = pad(PNG_HEADER);
    const result = await checkAttachment({
      originalFilename: "../../etc/passwd.png",
      declaredContentType: "image/png",
      sizeBytes: buffer.length,
      buffer,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects files over the size limit", async () => {
    const buffer = pad(PNG_HEADER);
    const result = await checkAttachment({
      originalFilename: "big.png",
      declaredContentType: "image/png",
      sizeBytes: MAX_ATTACHMENT_BYTES + 1,
      buffer,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when the aggregate ticket size would be exceeded", async () => {
    const buffer = pad(PNG_HEADER);
    const result = await checkAttachment(
      {
        originalFilename: "another.png",
        declaredContentType: "image/png",
        sizeBytes: buffer.length,
        buffer,
      },
      MAX_ATTACHMENT_BYTES * 10,
    );
    expect(result.ok).toBe(false);
  });
});
