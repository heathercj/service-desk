/**
 * Behaviour of the single-article fetch endpoint -- backs the ticket-form
 * preview panel (Section 6): a customer clicks a suggested article and
 * reads it inline, without leaving the ticket they're filling out.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({
  getArticleByIdForActor: vi.fn(),
}));
vi.mock("@/lib/knowledge/markdown-repo", () => ({ readArticleFile: vi.fn() }));

const { getArticleByIdForActor } = await import("@/lib/knowledge/knowledge-service");
const { readArticleFile } = await import("@/lib/knowledge/markdown-repo");
const { GET } = await import("./route");

const ARTICLE_ID = "66666666-0000-4000-8000-000000000001";

function fetchArticle() {
  return readResponse(
    GET(
      getRequest(`/api/knowledge/articles/${ARTICLE_ID}`),
      routeContext({ articleId: ARTICLE_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(getArticleByIdForActor).mockReset();
  vi.mocked(readArticleFile).mockReset();
  signOut();
});

feature("Fetching a single article for the preview panel", () => {
  scenario("A signed-in customer reads a published article inline", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the article is published and visible to them", () => {
      vi.mocked(getArticleByIdForActor).mockResolvedValue({
        id: ARTICLE_ID,
        title: "Resetting your VPN client",
        summary: "Steps to reset a stuck VPN profile.",
        department: { name: "Technology Support" },
        filePath: "technology-support/resetting-your-vpn-client.md",
      } as Awaited<ReturnType<typeof getArticleByIdForActor>>);
      vi.mocked(readArticleFile).mockResolvedValue({
        frontMatter: {} as never,
        body: "## Steps\n\n1. Sign out. 2. Sign back in.",
        relativePath: "technology-support/resetting-your-vpn-client.md",
        contentHash: "test-hash",
      });
    });

    const res = await s.when("they open the preview panel", () => fetchArticle());

    await s.then("the article's title, summary, and body are returned", () => {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        title: "Resetting your VPN client",
        summary: "Steps to reset a stuck VPN profile.",
        departmentName: "Technology Support",
        body: "## Steps\n\n1. Sign out. 2. Sign back in.",
      });
    });
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a fetch arrives", () => fetchArticle());

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
  });

  scenario("An internal-only article is refused to a customer", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses the actor", () => {
      vi.mocked(getArticleByIdForActor).mockRejectedValue(
        new ForbiddenError("You cannot view this article"),
      );
    });

    const res = await s.when("they attempt to open the panel", () => fetchArticle());

    await s.then("it is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A missing article is reported as not found", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("no such article exists", () => {
      vi.mocked(getArticleByIdForActor).mockRejectedValue(
        new NotFoundError("Article not found"),
      );
    });

    const res = await s.when("they attempt to open the panel", () => fetchArticle());

    await s.then("it is reported as not found", () => expect(res.status).toBe(404));
  });
});
