/**
 * Behaviour of the resolve endpoint -- step 2 of the demo path, and the
 * hinge of the whole flow: a ticket cannot reach RESOLVED until a knowledge
 * outcome has been recorded (the resolution gate, Section 11.3).
 *
 * The gate's rules are unit tested in lib/knowledge/resolution-gate.test.ts.
 * What matters here is that the route surfaces a blocked resolution as a
 * conflict the UI can act on, rather than a generic failure.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, DEPARTMENTS } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ resolveTicket: vi.fn() }));

const { resolveTicket } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";

function validResolution(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    resolutionSummary: "Replaced the faulty WiFi adapter driver.",
    resolutionSteps:
      "1. Confirmed the adapter was disabled in Device Manager. " +
      "2. Reinstalled the Intel driver. 3. Verified the connection.",
    ...overrides,
  };
}

/** Invokes the handler for TICKET_ID with the given body. */
function resolve(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/resolve`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(resolveTicket).mockReset();
  signOut();
});

feature("Ticket resolution", () => {
  scenario("An assigned agent resolves a ticket", async (s) => {
    const agent = await s.given("a department agent working the ticket", () => {
      const actor = actors.departmentAgent({ departments: { [DEPARTMENTS.it]: false } });
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the resolution gate is satisfied", () => {
      // resolveTicket returns the updated ticket alongside the gate verdict,
      // so the UI can explain why a resolution was or was not accepted.
      vi.mocked(resolveTicket).mockResolvedValue({
        ticket: { id: TICKET_ID, status: "RESOLVED", version: 4 },
        gate: { ok: true, blockingReasons: [] },
      } as unknown as Awaited<ReturnType<typeof resolveTicket>>);
    });

    const res = await s.when("they submit the resolution", () =>
      resolve(validResolution()),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the response reports the gate as passed", () => {
      expect(res.body).toMatchObject({ gate: { ok: true, blockingReasons: [] } });
    });

    await s.and("the ticket is resolved on that agent's behalf", () => {
      expect(resolveTicket).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        expect.objectContaining({ ticketId: TICKET_ID, version: 3 }),
      );
    });
  });

  scenario("Resolution is blocked while no knowledge outcome is recorded", async (s) => {
    await s.given("a department agent working the ticket", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the resolution gate rejects the attempt", () => {
      vi.mocked(resolveTicket).mockRejectedValue(
        new ConflictError(
          "No knowledge outcome is recorded (link an article, propose an update, draft a new article, or record an approved exception).",
        ),
      );
    });

    const res = await s.when("they try to resolve the ticket", () =>
      resolve(validResolution()),
    );

    await s.then("the attempt is refused as a conflict", () => {
      expect(res.status).toBe(409);
    });

    await s.and("the reason names the missing knowledge outcome", () => {
      expect((res.body as { error: string }).error).toMatch(/knowledge outcome/i);
    });
  });

  scenario("A customer may not resolve their own ticket", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses the actor", () => {
      vi.mocked(resolveTicket).mockRejectedValue(
        new ForbiddenError("You may not resolve this ticket"),
      );
    });

    const res = await s.when("they attempt to resolve it", () =>
      resolve(validResolution()),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("Resolving an unknown ticket reports not found", async (s) => {
    await s.given("a department agent", () => setCurrentActor(actors.departmentAgent()));

    await s.and("the ticket does not exist", () => {
      vi.mocked(resolveTicket).mockRejectedValue(new NotFoundError("Ticket not found"));
    });

    const res = await s.when("they attempt to resolve it", () =>
      resolve(validResolution()),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a resolution arrives", () => resolve(validResolution()));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is resolved", () =>
      expect(resolveTicket).not.toHaveBeenCalled(),
    );
  });

  scenario.each([
    { why: "a missing optimistic-concurrency version", patch: { version: undefined } },
    {
      why: "a summary below the minimum length",
      patch: { resolutionSummary: "too short" },
    },
    { why: "empty resolution steps", patch: { resolutionSteps: "" } },
  ])("Resolution is rejected for $why", async (example, s) => {
    await s.given("a department agent", () => setCurrentActor(actors.departmentAgent()));

    const res = await s.when(`they submit ${example.why}`, () =>
      resolve(validResolution(example.patch)),
    );

    await s.then("the submission is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is resolved", () =>
      expect(resolveTicket).not.toHaveBeenCalled(),
    );
  });
});
