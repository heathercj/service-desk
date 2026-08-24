/**
 * Behaviour of the triage-confirm endpoint -- step 1 of the demo path, where
 * a triage agent accepts or corrects the AI's suggested department, priority
 * and tags before the ticket enters a queue.
 *
 * The routing rules live in the ticket service; the route owns the shape of
 * the triage decision, the ticket id coming from the path, and the
 * error -> status mapping.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ confirmTriage: vi.fn() }));

const { confirmTriage } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-0000000000aa";

function validTriage(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    departmentKey: "TECHNOLOGY_SUPPORT",
    priority: "HIGH",
    ...overrides,
  };
}

function triage(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/triage`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

function triagedTicket() {
  return { id: TICKET_ID, status: "QUEUED", version: 2 } as unknown as Awaited<
    ReturnType<typeof confirmTriage>
  >;
}

beforeEach(() => {
  vi.mocked(confirmTriage).mockReset();
  signOut();
});

feature("Confirming a ticket's triage", () => {
  scenario("A triage agent routes a ticket to a department", async (s) => {
    const agent = await s.given("a signed-in triage agent", () => {
      const actor = actors.triageAgent();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the decision", () => {
      vi.mocked(confirmTriage).mockResolvedValue(triagedTicket());
    });

    const res = await s.when("they confirm the full triage decision", () =>
      triage(
        validTriage({
          category: "Network",
          tags: ["vpn", "urgent-site"],
          internalNote: "Second report from the same office today.",
          assigneeId: AGENT_ID,
        }),
      ),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the decision is recorded as that agent", () => {
      expect(confirmTriage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        expect.objectContaining({
          ticketId: TICKET_ID,
          version: 1,
          departmentKey: "TECHNOLOGY_SUPPORT",
          priority: "HIGH",
          category: "Network",
          tags: ["vpn", "urgent-site"],
          internalNote: "Second report from the same office today.",
          assigneeId: AGENT_ID,
        }),
      );
    });

    await s.and("the ticket comes back queued", () => {
      expect(res.body).toMatchObject({ status: "QUEUED", version: 2 });
    });
  });

  scenario("Triage with no tags sends an empty list, not nothing", async (s) => {
    await s.given("a signed-in triage agent", () => setCurrentActor(actors.triageAgent()));

    await s.and("the service accepts the decision", () => {
      vi.mocked(confirmTriage).mockResolvedValue(triagedTicket());
    });

    await s.when("they confirm triage without tagging the ticket", () =>
      triage(validTriage()),
    );

    await s.then("the service receives an empty tag list", () => {
      expect(confirmTriage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tags: [] }),
      );
    });
  });

  scenario("The path decides which ticket is triaged, not the body", async (s) => {
    await s.given("a signed-in triage agent", () => setCurrentActor(actors.triageAgent()));

    await s.and("the service accepts the decision", () => {
      vi.mocked(confirmTriage).mockResolvedValue(triagedTicket());
    });

    await s.when("the body names a different ticket than the URL", () =>
      triage(validTriage({ ticketId: "33333333-0000-4000-8000-000000000999" })),
    );

    await s.then("the ticket from the URL is the one triaged", () => {
      expect(confirmTriage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ticketId: TICKET_ID }),
      );
    });
  });

  scenario.each([
    {
      payload: "an unknown department",
      body: validTriage({ departmentKey: "FACILITIES" }),
    },
    { payload: "an unknown priority", body: validTriage({ priority: "SEVERE" }) },
    { payload: "no version", body: validTriage({ version: undefined }) },
    {
      payload: "an assignee that is not a uuid",
      body: validTriage({ assigneeId: "agent-7" }),
    },
    {
      payload: "more than ten tags",
      body: validTriage({ tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) }),
    },
  ])("A triage decision with $payload is rejected", async (example, s) => {
    await s.given("a signed-in triage agent", () => setCurrentActor(actors.triageAgent()));

    const res = await s.when("the request arrives", () => triage(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("the ticket is left untriaged", () =>
      expect(confirmTriage).not.toHaveBeenCalled(),
    );
  });

  scenario("A customer cannot triage a ticket", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses them", () => {
      vi.mocked(confirmTriage).mockRejectedValue(
        new ForbiddenError("You cannot triage tickets"),
      );
    });

    const res = await s.when("they attempt to triage it", () => triage(validTriage()));

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A ticket already past triage cannot be triaged again", async (s) => {
    await s.given("a signed-in triage agent", () => setCurrentActor(actors.triageAgent()));

    await s.and("the ticket has moved on", () => {
      vi.mocked(confirmTriage).mockRejectedValue(
        new ConflictError("Ticket is no longer in triage"),
      );
    });

    const res = await s.when("they attempt to triage it", () => triage(validTriage()));

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("Triaging an unknown ticket reports not found", async (s) => {
    await s.given("a signed-in triage agent", () => setCurrentActor(actors.triageAgent()));

    await s.and("no such ticket exists", () => {
      vi.mocked(confirmTriage).mockRejectedValue(new NotFoundError("Ticket not found"));
    });

    const res = await s.when("they attempt to triage it", () => triage(validTriage()));

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a triage request arrives", () => triage(validTriage()));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("nothing is triaged", () =>
      expect(confirmTriage).not.toHaveBeenCalled(),
    );
  });
});
