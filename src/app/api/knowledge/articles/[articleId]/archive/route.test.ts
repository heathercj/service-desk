/**
 * Behaviour of the article archive endpoint -- how a knowledge manager
 * retires an article that has gone stale without deleting the history the
 * tickets that cited it depend on.
 *
 * Which statuses may be archived is the service's rule. The route owns the
 * article id from the path, the actor it hands over, and the error -> status
 * mapping; it takes no body at all.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, ALL_ROLES } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({ archiveArticle: vi.fn() }));

const { archiveArticle } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";

function archive() {
  return readResponse(
    POST(
      getRequest(`/api/knowledge/articles/${ARTICLE_ID}/archive`),
      routeContext({ articleId: ARTICLE_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(archiveArticle).mockReset();
  signOut();
});

feature("Archiving a knowledge article", () => {
  scenario("A knowledge manager retires a stale article", async (s) => {
    const manager = await s.given("a signed-in knowledge manager", () => {
      const actor = actors.knowledgeManager();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the article can be archived from where it stands", () => {
      vi.mocked(archiveArticle).mockResolvedValue({
        id: ARTICLE_ID,
        status: "ARCHIVED",
      } as Awaited<ReturnType<typeof archiveArticle>>);
    });

    const res = await s.when("they archive it", () => archive());

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the article named in the path is archived as that manager", () => {
      expect(archiveArticle).toHaveBeenCalledWith(
        expect.objectContaining({ userId: manager.userId }),
        ARTICLE_ID,
      );
    });

    await s.and("the article comes back archived", () => {
      expect((res.body as { status: string }).status).toBe("ARCHIVED");
    });
  });

  scenario.each(
    ALL_ROLES.filter((role) => role !== "KNOWLEDGE_MANAGER").map((role) => ({ role })),
  )("A $role cannot archive an article", async (example, s) => {
    await s.given(`a signed-in ${example.role}`, () =>
      setCurrentActor(actors.customer({ roles: [example.role] })),
    );

    await s.and("the service refuses non-knowledge-managers", () => {
      vi.mocked(archiveArticle).mockRejectedValue(
        new ForbiddenError("Only a knowledge manager can archive articles"),
      );
    });

    const res = await s.when("they attempt to archive it", () => archive());

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));

    await s.and("the reason names the required role", () => {
      expect((res.body as { error: string }).error).toMatch(/knowledge manager/i);
    });
  });

  scenario("An already-archived article cannot be archived again", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("the article is not archivable from its current status", () => {
      vi.mocked(archiveArticle).mockRejectedValue(
        new ConflictError("Article is not archivable from its current status"),
      );
    });

    const res = await s.when("they attempt to archive it", () => archive());

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("Archiving an unknown article reports not found", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("no such article exists", () => {
      vi.mocked(archiveArticle).mockRejectedValue(new NotFoundError("Article not found"));
    });

    const res = await s.when("they attempt to archive it", () => archive());

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("an archive request arrives", () => archive());

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("nothing is archived", () =>
      expect(archiveArticle).not.toHaveBeenCalled(),
    );
  });
});
