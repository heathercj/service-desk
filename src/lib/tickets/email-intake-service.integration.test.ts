import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { FALLBACK_FRANCHISE_CODE } from "@/lib/tickets/franchise-lookup";
import { createFranchise, createTestUser } from "@/test-support/fixtures";
import { createTicketFromEmail } from "./email-intake-service";

/**
 * Requires a live Postgres connection. Covers the intake path a Microsoft
 * Graph webhook notification lands on: an inbound email at
 * support@alairhomes.com becomes a ticket, straight into Triage, with the
 * sender's identity resolved (not authenticated -- there's no session for
 * an inbound email) and the source marked so staff can see where it came
 * from. See docs/ENTRA_SETUP.md and src/app/api/webhooks/graph-email/route.ts.
 */
vi.mock("@/lib/graph/client", () => ({ graphFetch: vi.fn() }));
const { graphFetch } = await import("@/lib/graph/client");

/** No Entra match at all for this email -- neither a local User nor a directory hit. */
function mockEntraUserNotFound() {
  vi.mocked(graphFetch).mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);
}

/** A real Entra directory match, for a sender with no local User row yet. */
function mockEntraUserFound(profile: {
  id: string;
  displayName: string;
  mail: string;
  department: string | null;
}) {
  vi.mocked(graphFetch).mockResolvedValue({
    ok: true,
    json: async () => profile,
  } as Response);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

describe("email-intake-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(() => {
    vi.mocked(graphFetch).mockReset();
    mockEntraUserNotFound();
  });

  it("creates a ticket from an email sent by a known local user, straight into Triage", async () => {
    const sender = await createTestUser({ roles: ["CUSTOMER"] });
    const graphMessageId = `msg-${randomSuffix()}`;

    const result = await createTicketFromEmail({
      graphMessageId,
      fromEmail: sender.email,
      fromName: sender.displayName,
      subject: "Printer in the site office is offline again",
      bodyText: "It has been offline since this morning and we cannot print anything.",
    });

    expect(result.created).toBe(true);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    expect(ticket.status).toBe("SUBMITTED");
    expect(ticket.source).toBe("EMAIL");
    expect(ticket.submittedById).toBe(sender.userId);
    expect(ticket.submittedEmail).toBe(sender.email);
    expect(ticket.subject).toBe("Printer in the site office is offline again");
  });

  it("auto-provisions a real User when the sender has an Entra match but no local account", async () => {
    const email = `new-hire-${randomSuffix()}@alairhomes.com`;
    const entraObjectId = `entra-${randomSuffix()}`;
    mockEntraUserFound({
      id: entraObjectId,
      displayName: "New Hire",
      mail: email,
      department: null,
    });

    const result = await createTicketFromEmail({
      graphMessageId: `msg-${randomSuffix()}`,
      fromEmail: email,
      fromName: "New Hire",
      subject: "Cannot access the shared drive",
      bodyText: "I started this week and don't have access to the shared drive yet.",
    });

    expect(result.created).toBe(true);
    const provisioned = await db.user.findFirstOrThrow({ where: { email } });
    expect(provisioned.entraObjectId).toBe(entraObjectId);
    expect(provisioned.displayName).toBe("New Hire");

    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    expect(ticket.submittedById).toBe(provisioned.id);
  });

  it("still creates a ticket, rather than dropping the email, when the sender has no local account and no Entra match", async () => {
    const email = `unknown-${randomSuffix()}@example.com`;
    mockEntraUserNotFound();

    const result = await createTicketFromEmail({
      graphMessageId: `msg-${randomSuffix()}`,
      fromEmail: email,
      fromName: "Unknown Sender",
      subject: "Question about an invoice",
      bodyText: "I have a question about an invoice I received.",
    });

    expect(result.created).toBe(true);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    expect(ticket.submittedEmail).toBe(email);
  });

  it("does not create a second ticket for a redelivered Graph notification", async () => {
    const sender = await createTestUser({ roles: ["CUSTOMER"] });
    const graphMessageId = `msg-${randomSuffix()}`;
    const input = {
      graphMessageId,
      fromEmail: sender.email,
      fromName: sender.displayName,
      subject: "Duplicate delivery test",
      bodyText: "Graph occasionally redelivers the same notification.",
    };

    const first = await createTicketFromEmail(input);
    const second = await createTicketFromEmail(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.ticketId).toBe(first.ticketId);

    const count = await db.ticket.count({ where: { id: first.ticketId } });
    expect(count).toBe(1);
    const intakeRows = await db.emailIntakeMessage.count({ where: { graphMessageId } });
    expect(intakeRows).toBe(1);
  });

  it("falls back to the default franchise when Entra has no department for the sender", async () => {
    mockEntraUserNotFound();
    const fallback = await db.franchise.findUniqueOrThrow({
      where: { code: FALLBACK_FRANCHISE_CODE },
    });
    const sender = await createTestUser({ roles: ["CUSTOMER"] });

    const result = await createTicketFromEmail({
      graphMessageId: `msg-${randomSuffix()}`,
      fromEmail: sender.email,
      fromName: sender.displayName,
      subject: "Franchise fallback check",
      bodyText: "Exercises the franchise fallback path for email intake.",
    });

    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    expect(ticket.franchiseId).toBe(fallback.id);
  });

  it("resolves the franchise from the sender's Entra department", async () => {
    const franchise = await createFranchise("Alair Homes Regina");
    mockEntraUserFound({
      id: `entra-${randomSuffix()}`,
      displayName: "Regina Employee",
      mail: `regina-${randomSuffix()}@alairhomes.com`,
      department: franchise.name,
    });

    const result = await createTicketFromEmail({
      graphMessageId: `msg-${randomSuffix()}`,
      fromEmail: `regina-${randomSuffix()}@alairhomes.com`,
      fromName: "Regina Employee",
      subject: "Franchise match check",
      bodyText: "Exercises the franchise match path for email intake.",
    });

    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    expect(ticket.franchiseId).toBe(franchise.id);
  });
});
