import { env } from "@/lib/env";

/**
 * Plain-text bodies/subjects for the notification emails (Section:
 * notifications). Kept as pure functions -- no DB, no provider -- so the
 * wording is unit-tested independently of who ends up sending it. The
 * caller (ticket-service/knowledge-service) is responsible for deciding
 * *whether* to send, based on preferences; these functions only decide
 * *what* to send.
 */

export interface TicketEmailInput {
  ticketNumber: string;
  subject: string;
}

export interface KnowledgeArticleEmailInput {
  slug: string;
  title: string;
}

export interface EmailContent {
  subject: string;
  bodyText: string;
}

function ticketUrl(ticketNumber: string): string {
  return `${env.APP_BASE_URL}/tickets/${ticketNumber}`;
}

function articleUrl(slug: string): string {
  return `${env.APP_BASE_URL}/knowledge/${slug}`;
}

export function ticketAssignedEmail(ticket: TicketEmailInput): EmailContent {
  return {
    subject: `[${ticket.ticketNumber}] A ticket has been assigned to you`,
    bodyText:
      `${ticket.ticketNumber} -- ${ticket.subject} has been assigned to you.\n\n` +
      `View it here: ${ticketUrl(ticket.ticketNumber)}`,
  };
}

export function ticketCommentedByCustomerEmail(
  ticket: TicketEmailInput,
  customerName: string,
): EmailContent {
  return {
    subject: `[${ticket.ticketNumber}] New reply from ${customerName}`,
    bodyText:
      `${customerName} has updated ${ticket.ticketNumber} -- ${ticket.subject}.\n\n` +
      `View it here: ${ticketUrl(ticket.ticketNumber)}`,
  };
}

export function ticketDormantEmail(ticket: TicketEmailInput): EmailContent {
  return {
    subject: `[${ticket.ticketNumber}] No activity for 3+ days`,
    bodyText:
      `${ticket.ticketNumber} -- ${ticket.subject} is assigned to you and has had no ` +
      `activity for 3 or more days.\n\n` +
      `View it here: ${ticketUrl(ticket.ticketNumber)}`,
  };
}

export function knowledgeArticlePublishedEmail(
  article: KnowledgeArticleEmailInput,
): EmailContent {
  return {
    subject: `New knowledge article published: ${article.title}`,
    bodyText:
      `A new knowledge article, "${article.title}", has just been published.\n\n` +
      `Read it here: ${articleUrl(article.slug)}`,
  };
}
