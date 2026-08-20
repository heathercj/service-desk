import { NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth/session";
import { downloadAttachment } from "@/lib/storage/attachment-service";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

export const runtime = "nodejs";

const INLINE_RENDERABLE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;

  let actor;
  try {
    actor = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const { buffer, contentType, filename } = await downloadAttachment(
      actor,
      attachmentId,
    );

    const disposition = INLINE_RENDERABLE_TYPES.has(contentType)
      ? "inline"
      : "attachment";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(filename)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError)
      return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof NotFoundError)
      return NextResponse.json({ error: err.message }, { status: 404 });
    console.error("attachment download failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
