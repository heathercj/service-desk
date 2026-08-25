/**
 * Behaviour of the Microsoft Graph webhook that turns an inbound email at
 * support@alairhomes.com into a ticket. Two payload shapes arrive here:
 * the subscription-creation validation handshake, and change/lifecycle
 * notifications once the subscription is live. No session reaches this
 * route (Graph calls it directly) -- clientState is the security
 * boundary, checked in place of auth.
 */
import { beforeEach, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { feature, scenario } from "@/test/bdd";
import { jsonRequest, readResponse, TEST_ORIGIN } from "@/test/route-harness";

vi.mock("@/lib/env", () => ({
  env: { GRAPH_WEBHOOK_CLIENT_STATE: "test-client-state" },
}));
vi.mock("@/lib/graph/client", () => ({ graphFetch: vi.fn() }));
vi.mock("@/lib/graph/mailbox-subscription", () => ({
  renewGraphSubscription: vi.fn(),
}));
vi.mock("@/lib/tickets/email-intake-service", () => ({
  createTicketFromEmail: vi.fn(),
}));

const { graphFetch } = await import("@/lib/graph/client");
const { renewGraphSubscription } = await import("@/lib/graph/mailbox-subscription");
const { createTicketFromEmail } = await import("@/lib/tickets/email-intake-service");
const { POST } = await import("./route");

function notify(value: Record<string, unknown>[]) {
  return readResponse(POST(jsonRequest("/api/webhooks/graph-email", { value })));
}

beforeEach(() => {
  vi.mocked(graphFetch).mockReset();
  vi.mocked(renewGraphSubscription).mockReset();
  vi.mocked(createTicketFromEmail).mockReset();
});

feature("Inbound email webhook", () => {
  scenario("Graph's subscription-creation handshake is echoed back", async (s) => {
    const res = await s.when("Graph validates the endpoint", () =>
      readResponse(
        POST(
          new NextRequest(
            new URL("/api/webhooks/graph-email?validationToken=abc123", TEST_ORIGIN),
            { method: "POST" },
          ),
        ),
      ),
    );

    await s.then("the raw token is echoed back as plain text", async () => {
      expect(res.status).toBe(200);
      expect(res.body).toBe("abc123");
    });
  });

  scenario(
    "A change notification with the right clientState creates a ticket",
    async (s) => {
      await s.given("Graph will return the message content", () => {
        vi.mocked(graphFetch).mockResolvedValue({
          ok: true,
          json: async () => ({
            subject: "Printer is offline",
            bodyPreview: "It has been offline all morning.",
            from: { emailAddress: { address: "a@alairhomes.com", name: "A Sender" } },
          }),
        } as Response);
        vi.mocked(createTicketFromEmail).mockResolvedValue({
          ticketId: "ticket-1",
          created: true,
        });
      });

      const res = await s.when("the notification arrives", () =>
        notify([
          {
            subscriptionId: "sub-1",
            clientState: "test-client-state",
            resourceData: { id: "msg-1" },
          },
        ]),
      );

      await s.then("it is acknowledged", () => expect(res.status).toBe(202));

      await s.and("the message was turned into a ticket", () => {
        expect(createTicketFromEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            graphMessageId: "msg-1",
            fromEmail: "a@alairhomes.com",
            subject: "Printer is offline",
          }),
        );
      });
    },
  );

  scenario("A notification with the wrong clientState is refused", async (s) => {
    const res = await s.when("a spoofed notification arrives", () =>
      notify([
        {
          subscriptionId: "sub-1",
          clientState: "not-the-real-secret",
          resourceData: { id: "msg-1" },
        },
      ]),
    );

    await s.then("it is rejected", () => expect(res.status).toBe(401));

    await s.and("nothing is turned into a ticket", () => {
      expect(createTicketFromEmail).not.toHaveBeenCalled();
    });
  });

  scenario(
    "A lifecycle notification renews the subscription instead of making a ticket",
    async (s) => {
      const res = await s.when("Graph warns the subscription is about to expire", () =>
        notify([
          {
            subscriptionId: "sub-1",
            clientState: "test-client-state",
            lifecycleEvent: "reauthorizationRequired",
          },
        ]),
      );

      await s.then("it is acknowledged", () => expect(res.status).toBe(202));

      await s.and("the subscription is renewed", () => {
        expect(renewGraphSubscription).toHaveBeenCalledWith("sub-1");
      });

      await s.and("no ticket is created", () => {
        expect(createTicketFromEmail).not.toHaveBeenCalled();
      });
    },
  );
});
