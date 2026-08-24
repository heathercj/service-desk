/**
 * Behaviour of the article restore endpoint -- the undo beside archive, which
 * puts an archived article straight back on the portal as PUBLISHED rather
 * than sending it back through review.
 *
 * "Only an archived article can be restored" is a service rule, and the
 * service raises it as a forbidden rather than a conflict; the scenario
 * below pins that mapping down so a UI can rely on it. The route itself owns
 * the article id from the path and takes no body.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, ALL_ROLES } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({ restoreArticle: vi.fn() }));

const { restoreArticle } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";

function restore() {
  return readResponse(
    POST(
      getRequest(`/api/knowledge/articles/${ARTICLE_ID}/restore`),
      routeContext({ articleId: ARTICLE_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(restoreArticle).mockReset();
  signOut();
});

feature("Restoring an archived knowledge article", () => {
  scenario("A knowledge manager puts an archived article back", async (s) => {
    const manager = await s.given("a signed-in knowledge manager", () => {
      const actor = actors.knowledgeManager();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the article is archived", () => {
      vi.mocked(restoreArticle).mockResolvedValue({
        id: ARTICLE_ID,
        status: "PUBLISHED",
        archivedAt: null,
      } as Awaited<ReturnType<typeof restoreArticle>>);
    });

    const res = await s.when("they restore it", () => restore());

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the article named in the path is restored as that manager", () => {
      expect(restoreArticle).toHaveBeenCalledWith(
        expect.objectContaining({ userId: manager.userId }),
        ARTICLE_ID,
      );
    });

    await s.and("the article is published again, not back in review", () => {
      expect(res.body).toMatchObject({ status: "PUBLISHED", archivedAt: null });
    });
  });

  scenario.each(
    ALL_ROLES.filter((role) => role !== "KNOWLEDGE_MANAGER").map((role) => ({ role })),
  )("A $role cannot restore an article", async (example, s) => {
    await s.given(`a signed-in ${example.role}`, () =>
      setCurrentActor(actors.customer({ roles: [example.role] })),
    );

    await s.and("the service refuses non-knowledge-managers", () => {
      vi.mocked(restoreArticle).mockRejectedValue(
        new ForbiddenError("Only a knowledge manager can restore articles"),
      );
    });

    const res = await s.when("they attempt to restore it", () => restore());

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));

    await s.and("the reason names the required role", () => {
      expect((res.body as { error: string }).error).toMatch(/knowledge manager/i);
    });
  });

  scenario("An article that was never archived cannot be restored", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("the article is not archived", () => {
      vi.mocked(restoreArticle).mockRejectedValue(
        new ForbiddenError("Only an archived article can be restored"),
      );
    });

    const res = await s.when("they attempt to restore it", () => restore());

    await s.then("the attempt is refused as forbidden, not a conflict", () =>
      expect(res.status).toBe(403),
    );

    await s.and("the reason explains what is restorable", () => {
      expect((res.body as { error: string }).error).toMatch(/archived article/i);
    });
  });

  scenario("Restoring an unknown article reports not found", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("no such article exists", () => {
      vi.mocked(restoreArticle).mockRejectedValue(new NotFoundError("Article not found"));
    });

    const res = await s.when("they attempt to restore it", () => restore());

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a restore request arrives", () => restore());

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("nothing is restored", () =>
      expect(restoreArticle).not.toHaveBeenCalled(),
    );
  });
});
