import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import { uploadAttachment } from "@/lib/storage/attachment-service";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { MAX_ATTACHMENT_BYTES } from "@/lib/storage/attachment-policy";
import { checkRateLimit } from "@/lib/http/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;

  let actor;
  try {
    actor = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const rate = checkRateLimit(`attachment-upload:${actor.userId}`, {
    windowMs: 60_000,
    max: 15,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many uploads, please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) },
      },
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ATTACHMENT_BYTES * 2) {
    // *2 headroom for multipart overhead; the real per-file limit is
    // enforced again inside uploadAttachment().
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const attachment = await uploadAttachment(actor, {
      ticketId,
      originalFilename: file.name,
      declaredContentType: file.type || "application/octet-stream",
      buffer,
    });
    return NextResponse.json({
      id: attachment.id,
      originalFilename: attachment.originalFilename,
      scanStatus: attachment.scanStatus,
    });
  } catch (err) {
    if (err instanceof ForbiddenError)
      return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof NotFoundError)
      return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("attachment upload failed", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
