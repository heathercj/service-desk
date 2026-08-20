import "server-only";
import { db } from "@/lib/db";
import {
  assertNoHeaderInjection,
  sanitizeEmailSubject,
  sanitizePlainTextBody,
} from "./sanitize";

/**
 * Email provider abstraction (Section 9). `ConsoleEmailProvider` is the
 * only implementation wired up for the prototype: it never actually
 * delivers mail, it persists an OutboundEmail row with status
 * `CAPTURED_DEV` and surfaces it on the development-only mailbox screen
 * (/dev-mailbox). A real deployment would add a Microsoft Graph or Azure
 * Communication Services provider behind this same interface -- see
 * docs/ARCHITECTURE.md "Email integration" for what that requires.
 */
export interface OutboundEmailRequest {
  ticketId?: string;
  conversationMessageId?: string;
  toEmail: string;
  subject: string;
  bodyText: string;
}

export interface EmailSendResult {
  outboundEmailId: string;
  status: "QUEUED" | "CAPTURED_DEV" | "SENT" | "FAILED";
}

export interface EmailProvider {
  send(request: OutboundEmailRequest): Promise<EmailSendResult>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(request: OutboundEmailRequest): Promise<EmailSendResult> {
    assertNoHeaderInjection("toEmail", request.toEmail);
    const subject = sanitizeEmailSubject(request.subject);
    const bodyText = sanitizePlainTextBody(request.bodyText);

    const record = await db.outboundEmail.create({
      data: {
        ticketId: request.ticketId,
        conversationMessageId: request.conversationMessageId,
        toEmail: request.toEmail,
        subject,
        bodyText,
        // Captured, not delivered: Section 9 forbids claiming delivery for
        // mail that was only ever written to our own database.
        status: "CAPTURED_DEV",
      },
    });

    return { outboundEmailId: record.id, status: "CAPTURED_DEV" };
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider = new ConsoleEmailProvider();
  }
  return provider;
}
