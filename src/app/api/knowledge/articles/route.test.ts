/**
 * Behaviour of the draft-article endpoint -- step 3 of the demo path, where a
 * resolved ticket turns into a knowledge draft.
 *
 * The route owns validation and the internal-only choice the guided tour
 * teaches; the drafting rules themselves live in the knowledge service, so
 * these scenarios cover what crosses the HTTP boundary: the payload shape,
 * the actor the service is handed, and the error -> status mapping.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({ createDraftArticle: vi.fn() }));

const { createDraftArticle } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";
const TICKET_ID = "55555555-0000-4000-8000-000000000001";

/** A payload that satisfies every field of the route's schema. */
function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: "Resetting the VPN client",
    summary: "How to clear a stuck VPN session that refuses to reconnect.",
    departmentKey: "TECHNOLOGY_SUPPORT",
    tags: ["vpn", "network"],
    body: "Quit the client, delete the cached session file, then sign in again.",
    ...overrides,
  };
}

function createDraft(body: unknown) {
  return readResponse(POST(jsonRequest("/api/knowledge/articles", body)));
}

function draftResult() {
  return { id: ARTICLE_ID, slug: "resetting-the-vpn-client" } as Awaited<
    ReturnType<typeof createDraftArticle>
  >;
}

beforeEach(() => {
  vi.mocked(createDraftArticle).mockReset();
  signOut();
});

feature("Drafting a knowledge article", () => {
  scenario("An agent drafts an article from a resolved ticket", async (s) => {
    const agent = await s.given("a signed-in department agent", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the draft", () => {
      vi.mocked(createDraftArticle).mockResolvedValue(draftResult());
    });

    const res = await s.when("they submit a draft linked to the ticket", () =>
      createDraft(validDraft({ sourceTicketId: TICKET_ID })),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the draft is created as that agent", () => {
      expect(createDraftArticle).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        expect.objectContaining({
          title: "Resetting the VPN client",
          departmentKey: "TECHNOLOGY_SUPPORT",
          sourceTicketId: TICKET_ID,
        }),
      );
    });

    await s.and("the new article's id and slug come back", () => {
      expect(res.body).toEqual({
        articleId: ARTICLE_ID,
        slug: "resetting-the-vpn-client",
      });
    });
  });

  scenario("Visibility defaults to customer-facing when unstated", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service accepts the draft", () => {
      vi.mocked(createDraftArticle).mockResolvedValue(draftResult());
    });

    await s.when("they submit a draft that says nothing about visibility", () =>
      createDraft(validDraft()),
    );

    await s.then("the article is drafted as customer-facing", () => {
      expect(createDraftArticle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ internalOnly: false, tags: ["vpn", "network"] }),
      );
    });
  });

  scenario("An agent marks a draft internal-only", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service accepts the draft", () => {
      vi.mocked(createDraftArticle).mockResolvedValue(draftResult());
    });

    await s.when("they submit a draft flagged internal-only", () =>
      createDraft(validDraft({ internalOnly: true })),
    );

    await s.then("the internal-only choice reaches the service", () => {
      expect(createDraftArticle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ internalOnly: true }),
      );
    });
  });

  scenario.each([
    { field: "a too-short title", body: validDraft({ title: "no" }) },
    { field: "a too-short summary", body: validDraft({ summary: "short" }) },
    { field: "a too-short body", body: validDraft({ body: "thin" }) },
    {
      field: "a source ticket id that is not a uuid",
      body: validDraft({ sourceTicketId: "ticket-7" }),
    },
  ])("A draft with $field is rejected", async (example, s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    const res = await s.when("they submit the draft", () => createDraft(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("nothing is drafted", () =>
      expect(createDraftArticle).not.toHaveBeenCalled(),
    );
  });

  scenario("A customer cannot draft articles", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses them", () => {
      vi.mocked(createDraftArticle).mockRejectedValue(
        new ForbiddenError("You cannot draft knowledge articles"),
      );
    });

    const res = await s.when("they submit a draft", () => createDraft(validDraft()));

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("Drafting into an inactive department reports not found", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the department is not accepting articles", () => {
      vi.mocked(createDraftArticle).mockRejectedValue(
        new NotFoundError("Department not found"),
      );
    });

    const res = await s.when("they submit a draft", () => createDraft(validDraft()));

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a draft request arrives", () => createDraft(validDraft()));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("nothing is drafted", () =>
      expect(createDraftArticle).not.toHaveBeenCalled(),
    );
  });
});
