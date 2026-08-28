/**
 * Behaviour of the department-transfer endpoint -- moving a mis-routed
 * ticket to another department, optionally naming a new owner there in the
 * same action. `newAssigneeId` is optional: omitting it keeps the plain
 * department-only transfer (assignee cleared) that this route has always
 * supported.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ transferDepartment: vi.fn() }));

const { transferDepartment } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "44444444-0000-4000-8000-000000000001";
const NEW_ASSIGNEE_ID = "55555555-0000-4000-8000-000000000001";

function transfer(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/transfer`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(transferDepartment).mockReset();
  signOut();
});

feature("Transferring a mis-routed ticket", () => {
  scenario(
    "The current assignee transfers the ticket and names a new owner",
    async (s) => {
      await s.given("a department agent who is the ticket's current assignee", () =>
        setCurrentActor(actors.departmentAgent()),
      );

      await s.and("the transfer succeeds", () => {
        vi.mocked(transferDepartment).mockResolvedValue({
          status: "ASSIGNED",
          version: 3,
        } as Awaited<ReturnType<typeof transferDepartment>>);
      });

      const res = await s.when("they transfer it with a reason and a new owner", () =>
        transfer({
          version: 2,
          departmentKey: "TRAINING",
          reason: "Wrong department -- this is a training question.",
          newAssigneeId: NEW_ASSIGNEE_ID,
        }),
      );

      await s.then("the request succeeds", () => expect(res.status).toBe(200));

      await s.and(
        "the service receives the new department, reason, and new owner",
        () => {
          expect(transferDepartment).toHaveBeenCalledWith(
            expect.objectContaining({ roles: expect.any(Set) }),
            TICKET_ID,
            2,
            "TRAINING",
            "Wrong department -- this is a training question.",
            NEW_ASSIGNEE_ID,
          );
        },
      );
    },
  );

  scenario("A transfer with no new owner leaves the ticket unassigned", async (s) => {
    await s.given("a triage agent", () => setCurrentActor(actors.triageAgent()));

    await s.and("the transfer succeeds", () => {
      vi.mocked(transferDepartment).mockResolvedValue({
        status: "QUEUED",
        version: 3,
      } as Awaited<ReturnType<typeof transferDepartment>>);
    });

    const res = await s.when("they transfer it with a reason only", () =>
      transfer({ version: 2, departmentKey: "TRAINING", reason: "Wrong queue." }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with no new owner", () => {
      expect(transferDepartment).toHaveBeenCalledWith(
        expect.anything(),
        TICKET_ID,
        2,
        "TRAINING",
        "Wrong queue.",
        undefined,
      );
    });
  });

  scenario(
    "An agent who is not the assignee, manager, triage, or admin is refused",
    async (s) => {
      await s.given("a department agent who does not own this ticket", () =>
        setCurrentActor(actors.departmentAgent()),
      );

      await s.and("the service refuses the actor", () => {
        vi.mocked(transferDepartment).mockRejectedValue(
          new ForbiddenError("You cannot transfer this ticket"),
        );
      });

      const res = await s.when("they attempt the transfer", () =>
        transfer({ version: 2, departmentKey: "TRAINING", reason: "Wrong department." }),
      );

      await s.then("the transfer is forbidden", () => expect(res.status).toBe(403));
    },
  );

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a transfer arrives", () =>
      transfer({ version: 2, departmentKey: "TRAINING", reason: "Wrong department." }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
  });

  scenario("A transfer to an unknown department reports not found", async (s) => {
    await s.given("a triage agent", () => setCurrentActor(actors.triageAgent()));

    await s.and("the department does not exist or is inactive", () => {
      vi.mocked(transferDepartment).mockRejectedValue(
        new NotFoundError('Department "NOT_A_DEPARTMENT" is not available'),
      );
    });

    const res = await s.when("they submit the transfer", () =>
      transfer({
        version: 2,
        departmentKey: "NOT_A_DEPARTMENT",
        reason: "Wrong department.",
      }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario.each([
    {
      why: "a blank reason",
      body: { version: 2, departmentKey: "TRAINING", reason: "   " },
    },
    {
      why: "a non-UUID newAssigneeId",
      body: {
        version: 2,
        departmentKey: "TRAINING",
        reason: "Wrong department.",
        newAssigneeId: "not-a-uuid",
      },
    },
    { why: "no version at all", body: { departmentKey: "TRAINING", reason: "Wrong." } },
  ])("A transfer with $why is rejected", async (example, s) => {
    await s.given("a triage agent", () => setCurrentActor(actors.triageAgent()));

    const res = await s.when("they submit the transfer", () => transfer(example.body));

    await s.then("the transfer is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is transferred", () =>
      expect(transferDepartment).not.toHaveBeenCalled(),
    );
  });
});
