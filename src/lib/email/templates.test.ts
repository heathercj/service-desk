import { describe, expect, it } from "vitest";
import {
  knowledgeArticlePublishedEmail,
  ticketAssignedEmail,
  ticketAssignedSubmitterEmail,
  ticketCommentedByCustomerEmail,
  ticketDormantEmail,
} from "./templates";

const ticket = { ticketNumber: "T-000123", subject: "VPN keeps disconnecting" };

describe("ticketAssignedEmail", () => {
  it("names the ticket and links to it", () => {
    const { subject, bodyText } = ticketAssignedEmail(ticket);
    expect(subject).toContain("T-000123");
    expect(subject.toLowerCase()).toContain("assigned to you");
    expect(bodyText).toContain("T-000123");
    expect(bodyText).toContain(ticket.subject);
    expect(bodyText).toContain("/tickets/T-000123");
  });
});

describe("ticketAssignedSubmitterEmail", () => {
  it("tells the submitter their ticket has been assigned, by number, with a link", () => {
    const { subject, bodyText } = ticketAssignedSubmitterEmail(ticket);
    expect(subject).toContain("T-000123");
    expect(bodyText).toContain("T-000123");
    expect(bodyText).toContain("/tickets/T-000123");
  });

  it("reminds them an agent may follow up and to watch for that", () => {
    const { bodyText } = ticketAssignedSubmitterEmail(ticket);
    expect(bodyText.toLowerCase()).toMatch(/follow up|contact|reach out/);
    expect(bodyText.toLowerCase()).toMatch(/keep an eye on your email|watch for/);
  });
});

describe("ticketCommentedByCustomerEmail", () => {
  it("names the customer, the ticket, and links to it", () => {
    const { subject, bodyText } = ticketCommentedByCustomerEmail(ticket, "Dana Lee");
    expect(subject).toContain("T-000123");
    expect(bodyText).toContain("Dana Lee");
    expect(bodyText).toContain("T-000123");
    expect(bodyText).toContain("/tickets/T-000123");
  });
});

describe("ticketDormantEmail", () => {
  it("flags the lack of activity and links to the ticket", () => {
    const { subject, bodyText } = ticketDormantEmail(ticket);
    expect(subject).toContain("T-000123");
    expect(bodyText.toLowerCase()).toContain("no activity");
    expect(bodyText).toContain("/tickets/T-000123");
  });
});

describe("knowledgeArticlePublishedEmail", () => {
  it("names the article and links to it", () => {
    const { subject, bodyText } = knowledgeArticlePublishedEmail({
      slug: "printer-offline-troubleshooting",
      title: "Printer offline troubleshooting",
    });
    expect(subject).toContain("Printer offline troubleshooting");
    expect(bodyText).toContain("/knowledge/printer-offline-troubleshooting");
  });
});
