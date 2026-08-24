/**
 * Behaviour of the article visibility endpoint -- the internal-only switch the
 * guided tour teaches, which decides whether a published article is offered to
 * customers or kept to the desk.
 *
 * Who may flip it is a knowledge-manager rule enforced in the service; the
 * route owns the payload shape, the article id it acts on, and the error ->
 * status mapping, so those are what the scenarios below pin down.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, ALL_ROLES } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({ setArticleVisibility: vi.fn() }));

const { setArticleVisibility } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";

function setVisibility(body: unknown) {
  return readResponse(
    POST(
      jsonRequest(`/api/knowledge/articles/${ARTICLE_ID}/visibility`, body),
      routeContext({ articleId: ARTICLE_ID }),
    ),
  );
}

function articleWith(internalOnly: boolean) {
  return { id: ARTICLE_ID, internalOnly } as Awaited<
    ReturnType<typeof setArticleVisibility>
  >;
}

beforeEach(() => {
  vi.mocked(setArticleVisibility).mockReset();
  signOut();
});

feature("Changing a knowledge article's visibility", () => {
  scenario("A knowledge manager takes an article back off the portal", async (s) => {
    const manager = await s.given("a signed-in knowledge manager", () => {
      const actor = actors.knowledgeManager();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the article is currently customer-facing", () => {
      vi.mocked(setArticleVisibility).mockResolvedValue(articleWith(true));
    });

    const res = await s.when("they mark it internal-only", () =>
      setVisibility({ internalOnly: true }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the change is made to that article as that manager", () => {
      expect(setArticleVisibility).toHaveBeenCalledWith(
        expect.objectContaining({ userId: manager.userId }),
        ARTICLE_ID,
        true,
      );
    });

    await s.and("the article comes back internal-only", () => {
      expect((res.body as { internalOnly: boolean }).internalOnly).toBe(true);
    });
  });

  scenario("A knowledge manager puts an article back on the portal", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("the article is currently internal-only", () => {
      vi.mocked(setArticleVisibility).mockResolvedValue(articleWith(false));
    });

    const res = await s.when("they clear the internal-only flag", () =>
      setVisibility({ internalOnly: false }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the article is made customer-facing", () => {
      expect(setArticleVisibility).toHaveBeenCalledWith(
        expect.anything(),
        ARTICLE_ID,
        false,
      );
    });
  });

  scenario.each([
    { payload: "an empty body", body: {} },
    { payload: "a non-boolean flag", body: { internalOnly: "yes" } },
    { payload: "a null flag", body: { internalOnly: null } },
  ])("A request with $payload is rejected", async (example, s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    const res = await s.when("the request arrives", () => setVisibility(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("visibility is left alone", () =>
      expect(setArticleVisibility).not.toHaveBeenCalled(),
    );
  });

  scenario.each(
    ALL_ROLES.filter((role) => role !== "KNOWLEDGE_MANAGER").map((role) => ({ role })),
  )("A $role cannot change visibility", async (example, s) => {
    await s.given(`a signed-in ${example.role}`, () =>
      setCurrentActor(actors.customer({ roles: [example.role] })),
    );

    await s.and("the service refuses non-knowledge-managers", () => {
      vi.mocked(setArticleVisibility).mockRejectedValue(
        new ForbiddenError("Only a knowledge manager can change article visibility"),
      );
    });

    const res = await s.when("they attempt the change", () =>
      setVisibility({ internalOnly: true }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));

    await s.and("the reason names the required role", () => {
      expect((res.body as { error: string }).error).toMatch(/knowledge manager/i);
    });
  });

  scenario("Changing visibility on an unknown article reports not found", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("no such article exists", () => {
      vi.mocked(setArticleVisibility).mockRejectedValue(
        new NotFoundError("Article not found"),
      );
    });

    const res = await s.when("they attempt the change", () =>
      setVisibility({ internalOnly: true }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a visibility request arrives", () =>
      setVisibility({ internalOnly: true }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("visibility is left alone", () =>
      expect(setArticleVisibility).not.toHaveBeenCalled(),
    );
  });
});
