/**
 * Behaviour of the self-assign endpoint -- the step where a department
 * agent picks a queued ticket up before working it.
 *
 * The `version` field is optimistic concurrency: two agents claiming the
 * same ticket must not both succeed, so the stale-version scenario below is
 * the important one.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ selfAssignTicket: vi.fn() }));

const { selfAssignTicket } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";

function claim(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/assign-self`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(selfAssignTicket).mockReset();
  signOut();
});

feature("Claiming a queued ticket", () => {
  scenario("A department agent claims a ticket from their queue", async (s) => {
    const agent = await s.given("a department agent viewing their queue", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the ticket is unclaimed at version 2", () => {
      vi.mocked(selfAssignTicket).mockResolvedValue({
        status: "ASSIGNED",
        version: 3,
      } as Awaited<ReturnType<typeof selfAssignTicket>>);
    });

    const res = await s.when("they claim it", () => claim({ version: 2 }));

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the ticket is assigned to that agent at the version they saw", () => {
      expect(selfAssignTicket).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        TICKET_ID,
        2,
      );
    });
  });

  scenario("A second agent claiming the same ticket loses the race", async (s) => {
    await s.given("a department agent looking at a stale queue", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("another agent has already claimed the ticket", () => {
      vi.mocked(selfAssignTicket).mockRejectedValue(
        new ConflictError("This ticket has changed since you loaded it"),
      );
    });

    const res = await s.when("they claim it at the version they saw", () =>
      claim({ version: 2 }),
    );

    await s.then("the claim is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("An agent outside the ticket's department may not claim it", async (s) => {
    await s.given("a department agent from another department", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service refuses the actor", () => {
      vi.mocked(selfAssignTicket).mockRejectedValue(
        new ForbiddenError("You may not assign this ticket to yourself"),
      );
    });

    const res = await s.when("they claim it", () => claim({ version: 2 }));

    await s.then("the claim is forbidden", () => expect(res.status).toBe(403));
  });

  scenario.each([
    { why: "no version at all", body: {} },
    { why: "a zero version", body: { version: 0 } },
    { why: "a non-numeric version", body: { version: "2" } },
  ])("A claim with $why is rejected", async (example, s) => {
    await s.given("a department agent", () => setCurrentActor(actors.departmentAgent()));

    const res = await s.when("they submit the claim", () => claim(example.body));

    await s.then("the claim is rejected as invalid", () => expect(res.status).toBe(400));
    await s.and("nothing is assigned", () =>
      expect(selfAssignTicket).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a claim arrives", () => claim({ version: 2 }));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
  });
});
