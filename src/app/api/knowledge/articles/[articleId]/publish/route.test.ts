/**
 * Behaviour of the article publish endpoint -- step 4 of the demo path, the
 * review/confirm moment where a knowledge manager approves the article that
 * a resolved ticket produced.
 *
 * Publishing is knowledge-manager-only and is the act that makes an article
 * reusable by the deflection and similarity search, so the authorisation
 * scenarios below are the load-bearing ones.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, ALL_ROLES } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({ publishArticle: vi.fn() }));

const { publishArticle } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";

function publish() {
  return readResponse(
    POST(
      getRequest(`/api/knowledge/articles/${ARTICLE_ID}/publish`),
      routeContext({ articleId: ARTICLE_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(publishArticle).mockReset();
  signOut();
});

feature("Publishing a knowledge article", () => {
  scenario("A knowledge manager confirms an article under review", async (s) => {
    const manager = await s.given("a signed-in knowledge manager", () => {
      const actor = actors.knowledgeManager();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the article is awaiting review", () => {
      vi.mocked(publishArticle).mockResolvedValue({
        id: ARTICLE_ID,
        status: "PUBLISHED",
      } as Awaited<ReturnType<typeof publishArticle>>);
    });

    const res = await s.when("they publish it", () => publish());

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the article is published as that reviewer", () => {
      expect(publishArticle).toHaveBeenCalledWith(
        expect.objectContaining({ userId: manager.userId }),
        ARTICLE_ID,
      );
    });

    await s.and("the article is now published", () => {
      expect((res.body as { status: string }).status).toBe("PUBLISHED");
    });
  });

  scenario.each(
    ALL_ROLES.filter((role) => role !== "KNOWLEDGE_MANAGER").map((role) => ({ role })),
  )("A $role cannot publish an article", async (example, s) => {
    await s.given(`a signed-in ${example.role}`, () =>
      setCurrentActor(actors.customer({ roles: [example.role] })),
    );

    await s.and("the service refuses non-knowledge-managers", () => {
      vi.mocked(publishArticle).mockRejectedValue(
        new ForbiddenError("Only a knowledge manager can publish articles"),
      );
    });

    const res = await s.when("they attempt to publish", () => publish());

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));

    await s.and("the reason names the required role", () => {
      expect((res.body as { error: string }).error).toMatch(/knowledge manager/i);
    });
  });

  scenario("An already-published article cannot be published again", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("the article is no longer in a publishable status", () => {
      vi.mocked(publishArticle).mockRejectedValue(
        new ConflictError("Article is not publishable from its current status"),
      );
    });

    const res = await s.when("they attempt to publish it", () => publish());

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("Publishing an unknown article reports not found", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("no such article exists", () => {
      vi.mocked(publishArticle).mockRejectedValue(new NotFoundError("Article not found"));
    });

    const res = await s.when("they attempt to publish it", () => publish());

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a publish request arrives", () => publish());

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is published", () =>
      expect(publishArticle).not.toHaveBeenCalled(),
    );
  });
});
