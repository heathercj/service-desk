/**
 * Behaviour of the knowledge-outcome endpoint -- step 3 of the demo path.
 * This is what unblocks the resolution gate: before a ticket can be
 * resolved, the agent must say what happened to the knowledge (an existing
 * article covered it, an update is proposed, a new draft was written, or an
 * exception is recorded).
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({
  recordKnowledgeOutcome: vi.fn(),
}));

const { recordKnowledgeOutcome } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";
const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";

function submitOutcome(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/knowledge-outcome`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(recordKnowledgeOutcome).mockReset();
  vi.mocked(recordKnowledgeOutcome).mockResolvedValue({ ok: true } as never);
  signOut();
});

feature("Recording a knowledge outcome", () => {
  scenario("An agent drafts a new article from the resolution", async (s) => {
    const agent = await s.given("a department agent resolving a ticket", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    const res = await s.when("they record a new-draft outcome", () =>
      submitOutcome({ outcomeType: "NEW_DRAFT" }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the outcome is recorded against that ticket", () => {
      expect(recordKnowledgeOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        expect.objectContaining({ ticketId: TICKET_ID, outcomeType: "NEW_DRAFT" }),
      );
    });
  });

  scenario(
    "An agent links an existing article that already covers the issue",
    async (s) => {
      await s.given("a department agent resolving a ticket", () =>
        setCurrentActor(actors.departmentAgent()),
      );

      const res = await s.when("they link an existing article", () =>
        submitOutcome({ outcomeType: "LINKED_EXISTING", articleId: ARTICLE_ID }),
      );

      await s.then("the request succeeds", () => expect(res.status).toBe(200));

      await s.and("the outcome carries the linked article", () => {
        expect(recordKnowledgeOutcome).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            outcomeType: "LINKED_EXISTING",
            articleId: ARTICLE_ID,
          }),
        );
      });
    },
  );

  scenario.each([{ outcomeType: "PROPOSED_UPDATE" }, { outcomeType: "EXCEPTION" }])(
    "The $outcomeType outcome is accepted",
    async (example, s) => {
      await s.given("a department agent resolving a ticket", () =>
        setCurrentActor(actors.departmentAgent()),
      );

      const res = await s.when(`they record a ${example.outcomeType} outcome`, () =>
        submitOutcome({
          outcomeType: example.outcomeType,
          reason: "Covered by vendor documentation.",
        }),
      );

      await s.then("the request succeeds", () => expect(res.status).toBe(200));
    },
  );

  scenario("An unrecognised outcome type is rejected", async (s) => {
    await s.given("a department agent", () => setCurrentActor(actors.departmentAgent()));

    const res = await s.when("they send an outcome type outside the allowed set", () =>
      submitOutcome({ outcomeType: "SOMETHING_ELSE" }),
    );

    await s.then("the submission is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("no outcome is recorded", () =>
      expect(recordKnowledgeOutcome).not.toHaveBeenCalled(),
    );
  });

  scenario("A malformed article id is rejected", async (s) => {
    await s.given("a department agent", () => setCurrentActor(actors.departmentAgent()));

    const res = await s.when("they link an article by a non-uuid id", () =>
      submitOutcome({ outcomeType: "LINKED_EXISTING", articleId: "not-a-uuid" }),
    );

    await s.then("the submission is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
  });

  scenario("A customer may not record a knowledge outcome", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses the actor", () => {
      vi.mocked(recordKnowledgeOutcome).mockRejectedValue(
        new ForbiddenError("You may not record a knowledge outcome for this ticket"),
      );
    });

    const res = await s.when("they try to record an outcome", () =>
      submitOutcome({ outcomeType: "EXCEPTION", reason: "Not needed" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("an outcome submission arrives", () =>
      submitOutcome({ outcomeType: "NEW_DRAFT" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
  });
});
