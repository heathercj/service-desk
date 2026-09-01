/**
 * Behaviour of the Product Operating Model report's CSV export endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/reports/product-ops-report-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reports/product-ops-report-service")>();
  return { ...actual, getProductOpsReport: vi.fn() };
});

const { getProductOpsReport } = await import("@/lib/reports/product-ops-report-service");
const { GET } = await import("./route");

function exportCsv(query: Record<string, string> = {}) {
  return GET(getRequest("/api/reports/product/export", query));
}

beforeEach(() => {
  vi.mocked(getProductOpsReport).mockReset();
  signOut();
});

feature("Exporting the Product Operating Model report as CSV", () => {
  scenario("A product manager exports the report", async (s) => {
    await s.given("a signed-in product manager", () =>
      setCurrentActor(actors.productManager()),
    );

    await s.and("the service resolves", () => {
      vi.mocked(getProductOpsReport).mockResolvedValue([
        {
          ticketId: "t1",
          ticketNumber: "SD-000001",
          subject: "VPN drops every afternoon",
          departmentName: "Technology Support",
          priority: "URGENT",
          status: "RESOLVED",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          resolvedAt: new Date("2026-06-05T00:00:00.000Z"),
          resolutionHours: 96,
          improvementIdea: false,
          noKbArticleOpened: true,
          reopened: false,
          slowToResolve: true,
        },
      ]);
    });

    const res = await s.when("they request the CSV export", () =>
      exportCsv({ from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the response is a CSV download", () => {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain("attachment");
    });

    await s.and("the CSV contains the report data", async () => {
      const body = await res.text();
      expect(body).toContain("VPN drops every afternoon");
    });
  });

  scenario(
    "A signal filter narrows the export to match the page's current view",
    async (s) => {
      await s.given("a signed-in product manager", () =>
        setCurrentActor(actors.productManager()),
      );

      await s.and(
        "the service resolves with a mix of flagged and unflagged tickets",
        () => {
          vi.mocked(getProductOpsReport).mockResolvedValue([
            {
              ticketId: "t1",
              ticketNumber: "SD-000001",
              subject: "Reopened ticket",
              departmentName: "Technology Support",
              priority: "MEDIUM",
              status: "RESOLVED",
              createdAt: new Date("2026-06-01T00:00:00.000Z"),
              resolvedAt: new Date("2026-06-02T00:00:00.000Z"),
              resolutionHours: 24,
              improvementIdea: false,
              noKbArticleOpened: false,
              reopened: true,
              slowToResolve: false,
            },
            {
              ticketId: "t2",
              ticketNumber: "SD-000002",
              subject: "Slow ticket",
              departmentName: "Technology Support",
              priority: "MEDIUM",
              status: "RESOLVED",
              createdAt: new Date("2026-06-01T00:00:00.000Z"),
              resolvedAt: new Date("2026-06-10T00:00:00.000Z"),
              resolutionHours: 216,
              improvementIdea: false,
              noKbArticleOpened: false,
              reopened: false,
              slowToResolve: true,
            },
          ]);
        },
      );

      const res = await s.when("they export scoped to only the reopened signal", () =>
        exportCsv({ from: "2026-06-01", to: "2026-06-08", signal: "reopened" }),
      );

      await s.then("the CSV contains only the reopened ticket", async () => {
        const body = await res.text();
        expect(body).toContain("Reopened ticket");
        expect(body).not.toContain("Slow ticket");
      });
    },
  );

  scenario("A department agent is refused", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service refuses them", () => {
      vi.mocked(getProductOpsReport).mockRejectedValue(
        new ForbiddenError("You cannot view this report"),
      );
    });

    const res = await s.when("they request the CSV export", () =>
      exportCsv({ from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed date range is rejected", async (s) => {
    await s.given("a signed-in product manager", () =>
      setCurrentActor(actors.productManager()),
    );

    const res = await s.when("they request with an unparsable date", () =>
      exportCsv({ from: "not-a-date", to: "2026-06-08" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is exported", () =>
      expect(getProductOpsReport).not.toHaveBeenCalled(),
    );
  });

  scenario("A missing date range is rejected", async (s) => {
    await s.given("a signed-in product manager", () =>
      setCurrentActor(actors.productManager()),
    );

    const res = await s.when("they request with no dates at all", () => exportCsv());

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("an export request arrives", () =>
      exportCsv({ from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is exported", () =>
      expect(getProductOpsReport).not.toHaveBeenCalled(),
    );
  });
});
