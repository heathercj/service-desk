/**
 * Behaviour of the reassign endpoint -- a manager handing a ticket from one
 * agent in their department to another, as opposed to the assignee-driven
 * transfer between departments next door.
 *
 * Who may reassign, and the rule that the target must belong to the ticket's
 * department, are enforced in the ticket service. The route owns the payload
 * (a version and a target user), the ticket id from the path, and the
 * error -> status mapping.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, DEPARTMENTS } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ reassignTicket: vi.fn() }));

const { reassignTicket } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";
const TARGET_AGENT_ID = "00000000-0000-4000-8000-0000000000bb";

function reassign(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/reassign`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

function reassignedTicket() {
  return {
    id: TICKET_ID,
    assigneeId: TARGET_AGENT_ID,
    version: 4,
  } as unknown as Awaited<ReturnType<typeof reassignTicket>>;
}

beforeEach(() => {
  vi.mocked(reassignTicket).mockReset();
  signOut();
});

feature("Reassigning a ticket to another agent", () => {
  scenario("A department manager moves a ticket to a colleague", async (s) => {
    const manager = await s.given("a signed-in manager of the ticket's department", () => {
      const actor = actors.departmentManager({
        departments: { [DEPARTMENTS.it]: true },
      });
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the target agent is in the same department", () => {
      vi.mocked(reassignTicket).mockResolvedValue(reassignedTicket());
    });

    const res = await s.when("they reassign the ticket", () =>
      reassign({ version: 3, targetUserId: TARGET_AGENT_ID }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the ticket named in the path is reassigned as that manager", () => {
      expect(reassignTicket).toHaveBeenCalledWith(
        expect.objectContaining({ userId: manager.userId }),
        TICKET_ID,
        3,
        TARGET_AGENT_ID,
      );
    });

    await s.and("the ticket comes back on its new owner", () => {
      expect(res.body).toMatchObject({ assigneeId: TARGET_AGENT_ID, version: 4 });
    });
  });

  scenario.each([
    { payload: "no target user", body: { version: 1 } },
    {
      payload: "a target that is not a uuid",
      body: { version: 1, targetUserId: "agent-7" },
    },
    { payload: "no version", body: { targetUserId: TARGET_AGENT_ID } },
    {
      payload: "a version of zero",
      body: { version: 0, targetUserId: TARGET_AGENT_ID },
    },
    {
      payload: "a fractional version",
      body: { version: 2.5, targetUserId: TARGET_AGENT_ID },
    },
  ])("A reassignment with $payload is rejected", async (example, s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    const res = await s.when("the request arrives", () => reassign(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("the ticket keeps its owner", () =>
      expect(reassignTicket).not.toHaveBeenCalled(),
    );
  });

  scenario("An agent cannot reassign a ticket that is not theirs to give", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service refuses them", () => {
      vi.mocked(reassignTicket).mockRejectedValue(
        new ForbiddenError("You cannot reassign this ticket"),
      );
    });

    const res = await s.when("they attempt the reassignment", () =>
      reassign({ version: 3, targetUserId: TARGET_AGENT_ID }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A target outside the ticket's department is refused", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the target agent belongs to another department", () => {
      vi.mocked(reassignTicket).mockRejectedValue(
        new ForbiddenError("Target user is not a member of this department"),
      );
    });

    const res = await s.when("they attempt the reassignment", () =>
      reassign({ version: 3, targetUserId: TARGET_AGENT_ID }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));

    await s.and("the reason names the department mismatch", () => {
      expect((res.body as { error: string }).error).toMatch(/not a member/i);
    });
  });

  scenario("A stale version loses to whoever moved the ticket first", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("someone else has already changed the ticket", () => {
      vi.mocked(reassignTicket).mockRejectedValue(
        new ConflictError("This ticket was changed by someone else."),
      );
    });

    const res = await s.when("they submit against the version they had", () =>
      reassign({ version: 2, targetUserId: TARGET_AGENT_ID }),
    );

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("Reassigning an unknown ticket reports not found", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("no such ticket exists", () => {
      vi.mocked(reassignTicket).mockRejectedValue(new NotFoundError("Ticket not found"));
    });

    const res = await s.when("they attempt the reassignment", () =>
      reassign({ version: 1, targetUserId: TARGET_AGENT_ID }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a reassignment request arrives", () =>
      reassign({ version: 1, targetUserId: TARGET_AGENT_ID }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("the ticket keeps its owner", () =>
      expect(reassignTicket).not.toHaveBeenCalled(),
    );
  });
});
