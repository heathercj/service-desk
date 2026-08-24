/**
 * Behaviour of the deflection endpoint -- the payoff of the demo path: a
 * customer says the suggested article solved their issue and abandons
 * ticket creation.
 *
 * The privacy shape is the point. A deflection records the article and
 * (optionally) who, and deliberately stores none of the ticket text the
 * customer had typed -- so this spec asserts what is passed on, not just
 * that the call happened.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/knowledge-service", () => ({
  recordDeflectionEvent: vi.fn(),
}));

const { recordDeflectionEvent } = await import("@/lib/knowledge/knowledge-service");
const { POST } = await import("./route");

const ARTICLE_ID = "44444444-0000-4000-8000-000000000001";

function deflect(body: Record<string, unknown>) {
  return readResponse(POST(jsonRequest("/api/knowledge/deflection", body)));
}

beforeEach(() => {
  vi.mocked(recordDeflectionEvent).mockReset();
  vi.mocked(recordDeflectionEvent).mockResolvedValue(undefined as never);
  signOut();
});

feature("Recording a knowledge deflection", () => {
  scenario(
    "A customer reports that the suggested article solved their issue",
    async (s) => {
      const customer = await s.given(
        "a signed-in customer reading a suggested article",
        () => {
          const actor = actors.customer();
          setCurrentActor(actor);
          return actor;
        },
      );

      const res = await s.when("they confirm it resolved their problem", () =>
        deflect({ articleId: ARTICLE_ID }),
      );

      await s.then("the request succeeds", () => expect(res.status).toBe(200));

      await s.and("the deflection is credited to that article and actor", () => {
        expect(recordDeflectionEvent).toHaveBeenCalledWith(ARTICLE_ID, customer.userId);
      });

      await s.and("nothing beyond the article and actor is recorded", () => {
        expect(vi.mocked(recordDeflectionEvent).mock.calls[0]).toHaveLength(2);
      });
    },
  );

  scenario("A deflection without a valid article id is rejected", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    const res = await s.when("they submit a malformed article id", () =>
      deflect({ articleId: "not-a-uuid" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("no deflection is recorded", () =>
      expect(recordDeflectionEvent).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a deflection arrives", () =>
      deflect({ articleId: ARTICLE_ID }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("no deflection is recorded", () =>
      expect(recordDeflectionEvent).not.toHaveBeenCalled(),
    );
  });
});
