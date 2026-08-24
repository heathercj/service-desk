/**
 * Behaviour of the similarity-check endpoint -- the duplicate check an author
 * runs before drafting (Section 11.2), and the source of the candidate ids
 * the draft endpoint later asks them to justify overriding.
 *
 * Two things make this route more than a passthrough, and both are covered
 * below: the department key is resolved to an id (and an inactive department
 * is a 404 before any search runs), and every check is recorded against the
 * person who ran it, whether or not it found anything.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors, DEPARTMENTS } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/knowledge/similarity", () => ({
  getKnowledgeSearchProvider: vi.fn(),
  recordSimilarityCheck: vi.fn(),
}));
vi.mock("@/lib/tickets/department-lookup", () => ({
  requireActiveDepartment: vi.fn(),
}));

const { getKnowledgeSearchProvider, recordSimilarityCheck } = await import(
  "@/lib/knowledge/similarity"
);
const { requireActiveDepartment } = await import("@/lib/tickets/department-lookup");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";
const HIT = { articleId: "44444444-0000-4000-8000-000000000001", score: 0.91 };

const findSimilarArticles = vi.fn();

function validCheck(overrides: Record<string, unknown> = {}) {
  return {
    proposedTitle: "VPN will not reconnect after sleep",
    proposedSummary: "Client shows 'session expired' until the cache is cleared.",
    ...overrides,
  };
}

function check(body: Record<string, unknown>) {
  return readResponse(POST(jsonRequest("/api/knowledge/similar", body)));
}

beforeEach(() => {
  findSimilarArticles.mockReset().mockResolvedValue([HIT]);
  vi.mocked(getKnowledgeSearchProvider).mockReset().mockReturnValue({
    findSimilarArticles,
  });
  // The route ignores the stored row, so a placeholder is enough here.
  vi.mocked(recordSimilarityCheck)
    .mockReset()
    .mockResolvedValue({} as Awaited<ReturnType<typeof recordSimilarityCheck>>);
  vi.mocked(requireActiveDepartment)
    .mockReset()
    .mockResolvedValue({ id: DEPARTMENTS.it } as Awaited<
      ReturnType<typeof requireActiveDepartment>
    >);
  signOut();
});

feature("Checking a proposed article for duplicates", () => {
  scenario("An author checks a draft scoped to a department", async (s) => {
    const agent = await s.given("a signed-in department agent", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    const res = await s.when("they check a proposed title and summary", () =>
      check(
        validCheck({
          departmentKey: "TECHNOLOGY_SUPPORT",
          tags: ["vpn"],
          ticketId: TICKET_ID,
        }),
      ),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the department key is resolved to a department id", () => {
      expect(requireActiveDepartment).toHaveBeenCalledWith("TECHNOLOGY_SUPPORT");
      expect(findSimilarArticles).toHaveBeenCalledWith({
        proposedTitle: validCheck().proposedTitle,
        proposedSummary: validCheck().proposedSummary,
        departmentId: DEPARTMENTS.it,
        tags: ["vpn"],
      });
    });

    await s.and("the check is recorded against the person who ran it", () => {
      expect(recordSimilarityCheck).toHaveBeenCalledWith({
        ticketId: TICKET_ID,
        performedById: agent.userId,
        rawQueryText: `${validCheck().proposedTitle} ${validCheck().proposedSummary}`,
        candidateArticleIds: [HIT.articleId],
      });
    });

    await s.and("the candidates come back to the author", () => {
      expect(res.body).toEqual({ results: [HIT] });
    });
  });

  scenario("A check with no department searches across all of them", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.when("they check without naming a department", () => check(validCheck()));

    await s.then("no department lookup happens", () =>
      expect(requireActiveDepartment).not.toHaveBeenCalled(),
    );

    await s.and("the search is unscoped, with an empty tag list", () => {
      expect(findSimilarArticles).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: undefined, tags: [] }),
      );
    });
  });

  scenario("A check that finds nothing is still recorded", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("no similar article exists", () => {
      findSimilarArticles.mockResolvedValue([]);
    });

    const res = await s.when("they run the check", () => check(validCheck()));

    await s.then("the request succeeds with no candidates", () => {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ results: [] });
    });

    await s.and("the empty check is still recorded", () => {
      expect(recordSimilarityCheck).toHaveBeenCalledWith(
        expect.objectContaining({ candidateArticleIds: [] }),
      );
    });
  });

  scenario("A check against an inactive department reports not found", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the department is not available", () => {
      vi.mocked(requireActiveDepartment).mockRejectedValue(
        new NotFoundError('Department "MARKETING" is not available'),
      );
    });

    const res = await s.when("they run the check", () =>
      check(validCheck({ departmentKey: "MARKETING" })),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));

    await s.and("no search runs and nothing is recorded", () => {
      expect(findSimilarArticles).not.toHaveBeenCalled();
      expect(recordSimilarityCheck).not.toHaveBeenCalled();
    });
  });

  scenario.each([
    { payload: "an empty title", body: validCheck({ proposedTitle: "" }) },
    { payload: "an empty summary", body: validCheck({ proposedSummary: "" }) },
    {
      payload: "an unknown department",
      body: validCheck({ departmentKey: "FACILITIES" }),
    },
    {
      payload: "a ticket that is not a uuid",
      body: validCheck({ ticketId: "ticket-7" }),
    },
  ])("A check with $payload is rejected", async (example, s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    const res = await s.when("the request arrives", () => check(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("no search runs", () =>
      expect(findSimilarArticles).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a similarity check arrives", () => check(validCheck()));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("no search runs", () =>
      expect(findSimilarArticles).not.toHaveBeenCalled(),
    );
  });
});
