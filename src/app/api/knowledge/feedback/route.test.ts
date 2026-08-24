/**
 * Behaviour of the article feedback endpoint -- step 5 of the demo path,
 * where a reader says whether the article they were shown actually helped.
 * That signal is what makes reuse measurable.
 *
 * The route deliberately returns a bare `{ ok: true }` rather than the stored
 * feedback: a reader must not learn anything about other people's votes from
 * casting their own. The scenarios below pin that down alongside validation
 * and the error -> status mapping.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({ recordArticleFeedback: vi.fn() }));

const { recordArticleFeedback } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";
const TICKET_ID = "33333333-0000-4000-8000-000000000001";

function giveFeedback(body: Record<string, unknown>) {
  return readResponse(POST(jsonRequest("/api/knowledge/feedback", body)));
}

beforeEach(() => {
  vi.mocked(recordArticleFeedback).mockReset();
  vi.mocked(recordArticleFeedback).mockResolvedValue(
    undefined as Awaited<ReturnType<typeof recordArticleFeedback>>,
  );
  signOut();
});

feature("Recording feedback on a knowledge article", () => {
  scenario("A customer says the article solved their problem", async (s) => {
    const customer = await s.given("a signed-in customer", () => {
      const actor = actors.customer();
      setCurrentActor(actor);
      return actor;
    });

    const res = await s.when("they mark the article helpful from their ticket", () =>
      giveFeedback({ articleId: ARTICLE_ID, ticketId: TICKET_ID, wasHelpful: true }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the vote is recorded against the article and the ticket", () => {
      expect(recordArticleFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ userId: customer.userId }),
        ARTICLE_ID,
        TICKET_ID,
        true,
      );
    });

    await s.and("nothing about other people's votes comes back", () => {
      expect(res.body).toEqual({ ok: true });
    });
  });

  scenario("Feedback can be given without a ticket in hand", async (s) => {
    await s.given("a signed-in customer browsing the portal", () =>
      setCurrentActor(actors.customer()),
    );

    const res = await s.when("they mark an article unhelpful", () =>
      giveFeedback({ articleId: ARTICLE_ID, wasHelpful: false }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the vote is recorded with no ticket attached", () => {
      expect(recordArticleFeedback).toHaveBeenCalledWith(
        expect.anything(),
        ARTICLE_ID,
        undefined,
        false,
      );
    });
  });

  scenario.each([
    { payload: "no article", body: { wasHelpful: true } },
    {
      payload: "an article that is not a uuid",
      body: { articleId: "article-7", wasHelpful: true },
    },
    { payload: "no verdict", body: { articleId: ARTICLE_ID } },
    {
      payload: "a non-boolean verdict",
      body: { articleId: ARTICLE_ID, wasHelpful: "yes" },
    },
    {
      payload: "a ticket that is not a uuid",
      body: { articleId: ARTICLE_ID, ticketId: "ticket-7", wasHelpful: true },
    },
  ])("Feedback with $payload is rejected", async (example, s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when("the request arrives", () => giveFeedback(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("no vote is recorded", () =>
      expect(recordArticleFeedback).not.toHaveBeenCalled(),
    );
  });

  scenario("Feedback on an article the reader cannot see is refused", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the article is internal-only", () => {
      vi.mocked(recordArticleFeedback).mockRejectedValue(
        new ForbiddenError("You cannot see this article"),
      );
    });

    const res = await s.when("they attempt to vote on it", () =>
      giveFeedback({ articleId: ARTICLE_ID, wasHelpful: true }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("Feedback on an unknown article reports not found", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("no such article exists", () => {
      vi.mocked(recordArticleFeedback).mockRejectedValue(
        new NotFoundError("Article not found"),
      );
    });

    const res = await s.when("they attempt to vote on it", () =>
      giveFeedback({ articleId: ARTICLE_ID, wasHelpful: true }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a feedback request arrives", () =>
      giveFeedback({ articleId: ARTICLE_ID, wasHelpful: true }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("no vote is recorded", () =>
      expect(recordArticleFeedback).not.toHaveBeenCalled(),
    );
  });
});
