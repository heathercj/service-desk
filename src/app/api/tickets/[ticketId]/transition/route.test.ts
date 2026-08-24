/**
 * Behaviour of the status-transition endpoint -- the generic status move
 * behind the queue and detail views (park a ticket, send it back to the
 * customer, close it out).
 *
 * Which moves are legal is the state machine's job (lib/tickets/
 * state-machine.test.ts). What the route owns is taking the ticket id from
 * the path rather than the body, carrying the optimistic-concurrency
 * version through, and turning a rejected move into a 409 the UI can show.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, DEPARTMENTS } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";
import { InvalidTransitionError } from "@/lib/tickets/state-machine";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ transitionTicketStatus: vi.fn() }));

const { transitionTicketStatus } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";

function transition(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/transition`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

function ticketAt(status: string, version: number) {
  return { id: TICKET_ID, status, version } as unknown as Awaited<
    ReturnType<typeof transitionTicketStatus>
  >;
}

beforeEach(() => {
  vi.mocked(transitionTicketStatus).mockReset();
  signOut();
});

feature("Moving a ticket to another status", () => {
  scenario("An agent puts a ticket on hold with a reason", async (s) => {
    const agent = await s.given("a department agent working the ticket", () => {
      const actor = actors.departmentAgent({ departments: { [DEPARTMENTS.it]: false } });
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the move is legal from where the ticket stands", () => {
      vi.mocked(transitionTicketStatus).mockResolvedValue(ticketAt("PENDING", 5));
    });

    const res = await s.when("they move it to PENDING", () =>
      transition({ version: 4, toStatus: "PENDING", reason: "Waiting on the vendor." }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the move is made as that agent, on the ticket in the path", () => {
      expect(transitionTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        {
          ticketId: TICKET_ID,
          version: 4,
          toStatus: "PENDING",
          reason: "Waiting on the vendor.",
        },
      );
    });

    await s.and("the ticket comes back at its new status and version", () => {
      expect(res.body).toMatchObject({ status: "PENDING", version: 5 });
    });
  });

  scenario("The path decides which ticket moves, not the body", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the move is legal", () => {
      vi.mocked(transitionTicketStatus).mockResolvedValue(ticketAt("CLOSED", 6));
    });

    await s.when("the body names a different ticket than the URL", () =>
      transition({
        ticketId: "33333333-0000-4000-8000-000000000999",
        version: 5,
        toStatus: "CLOSED",
      }),
    );

    await s.then("the ticket from the URL is the one moved", () => {
      expect(transitionTicketStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ticketId: TICKET_ID }),
      );
    });
  });

  scenario.each([
    { payload: "no version", body: { toStatus: "CLOSED" } },
    { payload: "a version of zero", body: { version: 0, toStatus: "CLOSED" } },
    { payload: "a fractional version", body: { version: 1.5, toStatus: "CLOSED" } },
    { payload: "no target status", body: { version: 1 } },
    { payload: "a status that does not exist", body: { version: 1, toStatus: "DONE" } },
  ])("A request with $payload is rejected", async (example, s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    const res = await s.when("the request arrives", () => transition(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("the ticket is left alone", () =>
      expect(transitionTicketStatus).not.toHaveBeenCalled(),
    );
  });

  scenario("A move the state machine forbids is refused as a conflict", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the ticket cannot go there from its current status", () => {
      vi.mocked(transitionTicketStatus).mockRejectedValue(
        new InvalidTransitionError("SUBMITTED", "RESOLVED"),
      );
    });

    const res = await s.when("they attempt the move", () =>
      transition({ version: 1, toStatus: "RESOLVED" }),
    );

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );

    await s.and("the reason explains the illegal move", () => {
      expect((res.body as { error: string }).error).toMatch(/from SUBMITTED to RESOLVED/);
    });
  });

  scenario("A stale version loses to whoever moved first", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("someone else has already changed the ticket", () => {
      vi.mocked(transitionTicketStatus).mockRejectedValue(
        new ConflictError("Ticket was modified by someone else"),
      );
    });

    const res = await s.when("they submit against the version they had", () =>
      transition({ version: 2, toStatus: "CLOSED" }),
    );

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("A customer cannot drive a ticket's status", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses them", () => {
      vi.mocked(transitionTicketStatus).mockRejectedValue(
        new ForbiddenError("You cannot change this ticket's status"),
      );
    });

    const res = await s.when("they attempt the move", () =>
      transition({ version: 1, toStatus: "CLOSED" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("Moving an unknown ticket reports not found", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("no such ticket exists", () => {
      vi.mocked(transitionTicketStatus).mockRejectedValue(
        new NotFoundError("Ticket not found"),
      );
    });

    const res = await s.when("they attempt the move", () =>
      transition({ version: 1, toStatus: "CLOSED" }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a transition request arrives", () =>
      transition({ version: 1, toStatus: "CLOSED" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("the ticket is left alone", () =>
      expect(transitionTicketStatus).not.toHaveBeenCalled(),
    );
  });
});
