/**
 * Behaviour of the pre-intake suggestion endpoint -- step 5 of the demo
 * path, where a published article is offered to a customer describing a
 * similar issue, before they ever file a ticket.
 *
 * Two properties matter here and neither belongs to the AI provider: the
 * endpoint stays quiet until the customer has typed enough to search on,
 * and it runs entirely against local search (nothing leaves the system).
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));

const suggestArticlesForDraft = vi.fn();
vi.mock("@/lib/ai/local-provider", () => ({
  getAIProvider: () => ({ suggestArticlesForDraft }),
}));

const { POST } = await import("./route");

const ARTICLE = {
  articleId: "44444444-0000-4000-8000-000000000001",
  title: "Reconnecting a laptop to the office WiFi",
  score: 0.91,
};

function ask(body: Record<string, unknown>) {
  return readResponse<{ suggestions: unknown[] }>(
    POST(jsonRequest("/api/knowledge/suggestions", body)),
  );
}

beforeEach(() => {
  suggestArticlesForDraft.mockReset();
  suggestArticlesForDraft.mockResolvedValue([ARTICLE]);
  signOut();
});

feature("Suggesting knowledge before a ticket is filed", () => {
  scenario("A customer describing a known issue is offered the article", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when("they have typed a recognisable problem description", () =>
      ask({
        subject: "Laptop will not connect to WiFi",
        description: "My laptop cannot join the office WiFi since this morning.",
      }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the matching article is suggested", () => {
      expect(res.body.suggestions).toEqual([ARTICLE]);
    });

    await s.and("at most five suggestions are requested", () => {
      expect(suggestArticlesForDraft).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 }),
      );
    });
  });

  scenario.each([
    { why: "nothing has been typed yet", body: { subject: "", description: "" } },
    {
      why: "the subject is still too short to search on",
      body: { subject: "wi", description: "" },
    },
    {
      why: "the description is still too short to search on",
      body: { subject: "", description: "no wifi" },
    },
  ])("No search runs while $why", async (example, s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when("suggestions are requested", () => ask(example.body));

    await s.then("the request succeeds", () => expect(res.status).toBe(200));
    await s.and("no suggestions are returned", () =>
      expect(res.body.suggestions).toEqual([]),
    );
    await s.and("the search provider is never called", () =>
      expect(suggestArticlesForDraft).not.toHaveBeenCalled(),
    );
  });

  scenario("An over-long description is rejected rather than truncated", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when("they submit a description beyond the maximum length", () =>
      ask({ subject: "WiFi problem", description: "x".repeat(8001) }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("no search runs", () =>
      expect(suggestArticlesForDraft).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("suggestions are requested", () =>
      ask({
        subject: "Laptop will not connect to WiFi",
        description: "It cannot join the network.",
      }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("no search runs", () =>
      expect(suggestArticlesForDraft).not.toHaveBeenCalled(),
    );
  });
});
