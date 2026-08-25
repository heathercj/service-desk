import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac/errors";
import { createFranchise, createTestUser } from "@/test-support/fixtures";
import { createTicket } from "@/lib/tickets/ticket-service";
import type { CreateTicketInput } from "@/lib/validation/ticket-schemas";
import { downloadAttachment, uploadAttachment } from "./attachment-service";

// createTicket() looks up the submitter's Entra department over the
// network (src/lib/tickets/franchise-lookup.ts) -- stubbed as "not found"
// so this suite never depends on real network access. Falls back to the
// FALLBACK_FRANCHISE_CODE franchise seeded by ensureRolesAndDepartments().
vi.mock("@/lib/graph/client", () => ({
  graphFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
}));

const PNG_HEADER = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(64).fill(0),
]);
const EXE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, ...Array(64).fill(0)]);

/** Requires a live Postgres connection -- see README. */
describe("attachment-service integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // franchiseId param kept (unused) so existing call sites stay valid --
  // franchise is now derived server-side, not supplied.
  async function ticketInput(_franchiseId: string): Promise<CreateTicketInput> {
    return {
      subject: "Screenshot attached of the error",
      description:
        "See attached screenshot for the exact error message shown on screen when this happens.",
      isProjectRelated: false,
      urls: [],
      consentAcknowledged: true,
      attemptedArticleIds: [],
    };
  }

  it("rejects an executable disguised with an image filename", async () => {
    const franchise = await createFranchise();
    const customer = await createTestUser({ roles: ["CUSTOMER"] });
    const ticket = await createTicket(customer, await ticketInput(franchise.id));

    await expect(
      uploadAttachment(customer, {
        ticketId: ticket.id,
        originalFilename: "screenshot.png",
        declaredContentType: "image/png",
        buffer: EXE_HEADER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks a customer who does not own the ticket from downloading its attachment", async () => {
    const franchise = await createFranchise();
    const owner = await createTestUser({ roles: ["CUSTOMER"] });
    const otherCustomer = await createTestUser({ roles: ["CUSTOMER"] });
    const ticket = await createTicket(owner, await ticketInput(franchise.id));

    const attachment = await uploadAttachment(owner, {
      ticketId: ticket.id,
      originalFilename: "screenshot.png",
      declaredContentType: "image/png",
      buffer: PNG_HEADER,
    });

    await expect(downloadAttachment(otherCustomer, attachment.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("blocks download while the attachment is still pending scan, then allows it once clean", async () => {
    const franchise = await createFranchise();
    const owner = await createTestUser({ roles: ["CUSTOMER"] });
    const ticket = await createTicket(owner, await ticketInput(franchise.id));

    const attachment = await uploadAttachment(owner, {
      ticketId: ticket.id,
      originalFilename: "screenshot.png",
      declaredContentType: "image/png",
      buffer: PNG_HEADER,
    });

    // The scan runs asynchronously (fire-and-forget); give it a moment.
    await new Promise((r) => setTimeout(r, 250));

    const result = await downloadAttachment(owner, attachment.id);
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});
