/**
 * Behaviour of the knowledge-report CSV export endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/reports/knowledge-report-service", () => ({
  getKnowledgeReport: vi.fn(),
}));

const { getKnowledgeReport } = await import("@/lib/reports/knowledge-report-service");
const { GET } = await import("./route");

function exportCsv(query: Record<string, string> = {}) {
  return GET(getRequest("/api/reports/knowledge/export", query));
}

beforeEach(() => {
  vi.mocked(getKnowledgeReport).mockReset();
  signOut();
});

feature("Exporting the knowledge report as CSV", () => {
  scenario("A knowledge manager exports the report", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("the service resolves", () => {
      vi.mocked(getKnowledgeReport).mockResolvedValue([
        {
          articleId: "a1",
          title: "Resetting the VPN client",
          departmentName: "Technology Support",
          status: "PUBLISHED",
          contentUpdatedAt: new Date("2025-01-01T00:00:00.000Z"),
          ageInDays: 600,
          usageCount: 0,
          helpfulCount: 0,
          notHelpfulCount: 0,
          deflectionCount: 0,
          ticketsSolvedCount: 0,
          isStale: true,
          isUnused: true,
        },
      ]);
    });

    const res = await s.when("they request the CSV export", () => exportCsv());

    await s.then("the response is a CSV download", () => {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain("attachment");
    });

    await s.and("the CSV contains the report data", async () => {
      const body = await res.text();
      expect(body).toContain("Resetting the VPN client");
    });
  });

  scenario("A staleDays override reaches the service", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    await s.and("the service resolves", () => {
      vi.mocked(getKnowledgeReport).mockResolvedValue([]);
    });

    await s.when("they request with a custom staleDays", () =>
      exportCsv({ staleDays: "90" }),
    );

    await s.then("the service receives the parsed value", () => {
      expect(getKnowledgeReport).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ staleDays: 90 }),
      );
    });
  });

  scenario("A non-knowledge-manager is refused", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service refuses them", () => {
      vi.mocked(getKnowledgeReport).mockRejectedValue(
        new ForbiddenError("You cannot view knowledge reports"),
      );
    });

    const res = await s.when("they request the CSV export", () => exportCsv());

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed staleDays is rejected", async (s) => {
    await s.given("a signed-in knowledge manager", () =>
      setCurrentActor(actors.knowledgeManager()),
    );

    const res = await s.when("they request with a non-numeric staleDays", () =>
      exportCsv({ staleDays: "not-a-number" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is exported", () =>
      expect(getKnowledgeReport).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("an export request arrives", () => exportCsv());

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is exported", () =>
      expect(getKnowledgeReport).not.toHaveBeenCalled(),
    );
  });
});
