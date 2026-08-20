import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/session";
import { canDownloadAttachment, canViewTicket, toPolicyActor } from "@/lib/rbac/policies";
import { assertAuthorized, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { recordAuditEvent } from "@/lib/audit/audit-log";
import { checkAttachment, MAX_ATTACHMENTS_PER_TICKET } from "./attachment-policy";
import { getObjectStorageProvider } from "./object-storage";
import { getMalwareScanProvider } from "./malware-scan";

export interface UploadAttachmentInput {
  ticketId: string;
  originalFilename: string;
  declaredContentType: string;
  buffer: Buffer;
}

export async function uploadAttachment(actor: AuthContext, input: UploadAttachmentInput) {
  const policyActor = toPolicyActor(actor);
  const ticket = await db.ticket.findUnique({ where: { id: input.ticketId } });
  if (!ticket) throw new NotFoundError("Ticket not found");
  assertAuthorized(
    canViewTicket(policyActor, ticket),
    "You do not have access to this ticket",
  );
  assertAuthorized(
    !["CLOSED", "CANCELLED"].includes(ticket.status),
    "Attachments cannot be added to a closed or cancelled ticket",
  );

  const existing = await db.attachment.findMany({ where: { ticketId: input.ticketId } });
  assertAuthorized(
    existing.length < MAX_ATTACHMENTS_PER_TICKET,
    "This ticket already has the maximum number of attachments",
  );
  const currentAggregateBytes = existing.reduce((sum, a) => sum + a.sizeBytes, 0);

  const check = await checkAttachment(
    {
      originalFilename: input.originalFilename,
      declaredContentType: input.declaredContentType,
      sizeBytes: input.buffer.byteLength,
      buffer: input.buffer,
    },
    currentAggregateBytes,
  );

  if (
    !check.ok ||
    !check.storedFilename ||
    !check.checksumSha256 ||
    !check.detectedContentType
  ) {
    throw new ForbiddenError(check.reason ?? "File failed validation");
  }

  await getObjectStorageProvider().write(check.storedFilename, input.buffer);

  const attachment = await db.attachment.create({
    data: {
      ticketId: input.ticketId,
      uploadedById: actor.userId,
      originalFilename: input.originalFilename.slice(0, 200),
      storedFilename: check.storedFilename,
      contentType: check.detectedContentType,
      sizeBytes: input.buffer.byteLength,
      checksumSha256: check.checksumSha256,
      scanStatus: "PENDING",
    },
  });

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "ATTACHMENT_UPLOADED",
    entityType: "Attachment",
    entityId: attachment.id,
    newValue: {
      ticketId: input.ticketId,
      contentType: check.detectedContentType,
      sizeBytes: input.buffer.byteLength,
    },
  });

  // Fire-and-forget async scan (Section 6: scanning is asynchronous). A real
  // deployment would enqueue this to a scanning service instead of running
  // it inline; the prototype's heuristic scan is fast enough to run
  // in-process without blocking the upload response.
  void runScanAndUpdate(attachment.id, input.buffer, input.originalFilename);

  return attachment;
}

async function runScanAndUpdate(
  attachmentId: string,
  buffer: Buffer,
  originalFilename: string,
) {
  try {
    const result = await getMalwareScanProvider().scan(buffer, originalFilename);
    await db.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: result.outcome, scanNote: result.note },
    });
  } catch {
    await db.attachment
      .update({
        where: { id: attachmentId },
        data: { scanStatus: "SCAN_UNAVAILABLE", scanNote: "Scan provider error" },
      })
      .catch(() => undefined);
  }
}

export async function downloadAttachment(actor: AuthContext, attachmentId: string) {
  const policyActor = toPolicyActor(actor);
  const attachment = await db.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw new NotFoundError("Attachment not found");
  if (!attachment.ticketId) throw new NotFoundError("Attachment not found");

  const ticket = await db.ticket.findUnique({ where: { id: attachment.ticketId } });
  if (!ticket) throw new NotFoundError("Attachment not found");

  assertAuthorized(
    canDownloadAttachment(policyActor, ticket),
    "You do not have access to this attachment",
  );
  assertAuthorized(
    attachment.scanStatus === "CLEAN",
    attachment.scanStatus === "PENDING"
      ? "This file is still being scanned"
      : "This file is not available for download",
  );

  const buffer = await getObjectStorageProvider().read(attachment.storedFilename);
  if (!buffer) throw new NotFoundError("Stored file is missing");

  await recordAuditEvent({
    actorId: actor.userId,
    actorDisplayName: actor.displayName,
    action: "ATTACHMENT_DOWNLOADED",
    entityType: "Attachment",
    entityId: attachment.id,
  });

  return {
    buffer,
    contentType: attachment.contentType,
    filename: attachment.originalFilename,
  };
}
