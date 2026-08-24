/**
 * Behaviour of the ticket intake endpoint -- step 1 of the demo path
 * (intake -> resolution -> knowledge article -> review -> reuse).
 *
 * The route is a thin wrapper, so this covers what the route owns: who may
 * call it, what it rejects, and the payload it returns. The rules about
 * what a valid ticket *means* live in ticket-service and its own tests.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({
  createTicket: vi.fn(),
}));

const { createTicket } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const FRANCHISE_ID = "22222222-0000-4000-8000-000000000001";

/** A payload that satisfies createTicketSchema; scenarios override one field. */
function validIntake(overrides: Record<string, unknown> = {}) {
  return {
    franchiseId: FRANCHISE_ID,
    subject: "Laptop will not connect to the office WiFi",
    description:
      "Since this morning my laptop cannot join the office WiFi network. " +
      "Other devices connect without any problem.",
    isProjectRelated: false,
    urls: [],
    consentAcknowledged: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(createTicket).mockReset();
  signOut();
});

feature("Ticket intake", () => {
  scenario("A customer submits a well-formed ticket", async (s) => {
    const customer = await s.given("a signed-in customer", () => {
      const actor = actors.customer();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service will accept the ticket", () => {
      vi.mocked(createTicket).mockResolvedValue({
        id: "33333333-0000-4000-8000-000000000001",
        ticketNumber: "SD-1042",
      } as Awaited<ReturnType<typeof createTicket>>);
    });

    const res = await s.when("they submit the intake form", () =>
      readResponse<{ ticketId: string; ticketNumber: string }>(
        POST(jsonRequest("/api/tickets", validIntake())),
      ),
    );

    await s.then("the request succeeds", () => {
      expect(res.status).toBe(200);
    });

    await s.and("they are told the new ticket's number", () => {
      expect(res.body).toEqual({
        ticketId: "33333333-0000-4000-8000-000000000001",
        ticketNumber: "SD-1042",
      });
    });

    await s.and("the ticket is created as that customer", () => {
      expect(createTicket).toHaveBeenCalledTimes(1);
      expect(createTicket).toHaveBeenCalledWith(
        expect.objectContaining({ userId: customer.userId }),
        expect.objectContaining({ subject: validIntake().subject }),
      );
    });
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a ticket submission arrives", () =>
      readResponse<{ error: string }>(POST(jsonRequest("/api/tickets", validIntake()))),
    );

    await s.then("the request is unauthenticated", () => {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthenticated");
    });

    await s.and("no ticket is created", () => {
      expect(createTicket).not.toHaveBeenCalled();
    });
  });

  scenario("The privacy consent checkbox is mandatory", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when("they submit without acknowledging consent", () =>
      readResponse<{ error: string }>(
        POST(jsonRequest("/api/tickets", validIntake({ consentAcknowledged: false }))),
      ),
    );

    await s.then("the submission is rejected as invalid", () => {
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request");
    });

    await s.and("no ticket is created", () => {
      expect(createTicket).not.toHaveBeenCalled();
    });
  });

  scenario.each([
    { field: "subject", value: "", why: "an empty subject" },
    {
      field: "description",
      value: "too short",
      why: "a description under the minimum length",
    },
    { field: "franchiseId", value: "not-a-uuid", why: "a malformed franchise id" },
  ])("Intake is rejected for $why", async (example, s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when(`they submit ${example.why}`, () =>
      readResponse(
        POST(
          jsonRequest("/api/tickets", validIntake({ [example.field]: example.value })),
        ),
      ),
    );

    await s.then("the submission is rejected as invalid", () => {
      expect(res.status).toBe(400);
    });

    await s.and("no ticket is created", () => {
      expect(createTicket).not.toHaveBeenCalled();
    });
  });
});
