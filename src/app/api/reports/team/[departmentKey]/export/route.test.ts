/**
 * Behaviour of the team-report CSV export endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { getRequest, routeContext } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/reports/team-report-service", () => ({ getTeamReport: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { department: { findUnique: vi.fn() } },
}));

const { getTeamReport } = await import("@/lib/reports/team-report-service");
const { db } = await import("@/lib/db");
const { GET } = await import("./route");

function exportCsv(departmentKey: string, query: Record<string, string> = {}) {
  return GET(
    getRequest(`/api/reports/team/${departmentKey}/export`, query),
    routeContext({ departmentKey }),
  );
}

beforeEach(() => {
  vi.mocked(getTeamReport).mockReset();
  vi.mocked(db.department.findUnique).mockReset();
  signOut();
});

feature("Exporting the team report as CSV", () => {
  scenario("A manager exports their department's report", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the department and service resolve", () => {
      vi.mocked(db.department.findUnique).mockResolvedValue({
        id: "dept-1",
        key: "TECHNOLOGY_SUPPORT",
      } as Awaited<ReturnType<typeof db.department.findUnique>>);
      vi.mocked(getTeamReport).mockResolvedValue([
        {
          agentId: "u1",
          agentName: "Alex Agent",
          stillInDepartment: true,
          assignedCount: 3,
          resolvedCount: 2,
          avgResolutionHours: 4.5,
        },
      ]);
    });

    const res = await s.when("they request the CSV export", () =>
      exportCsv("TECHNOLOGY_SUPPORT", { from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the response is a CSV download", () => {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain("attachment");
    });

    await s.and("the CSV contains the report data", async () => {
      const body = await res.text();
      expect(body).toContain("Alex Agent");
    });
  });

  scenario("A manager of a different department is refused", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the department resolves, but the service refuses them", () => {
      vi.mocked(db.department.findUnique).mockResolvedValue({
        id: "dept-2",
        key: "TRAINING",
      } as Awaited<ReturnType<typeof db.department.findUnique>>);
      vi.mocked(getTeamReport).mockRejectedValue(
        new ForbiddenError("You cannot view this department's reports"),
      );
    });

    const res = await s.when("they request the CSV export", () =>
      exportCsv("TRAINING", { from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("An unknown department key reports not found", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("no such department exists", () => {
      vi.mocked(db.department.findUnique).mockResolvedValue(null);
    });

    const res = await s.when("they request the CSV export", () =>
      exportCsv("NOT_A_DEPARTMENT", { from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("A malformed date range is rejected", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    const res = await s.when("they request with an unparsable date", () =>
      exportCsv("TECHNOLOGY_SUPPORT", { from: "not-a-date", to: "2026-06-08" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is exported", () =>
      expect(getTeamReport).not.toHaveBeenCalled(),
    );
  });

  scenario("A missing date range is rejected", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    const res = await s.when("they request with no dates at all", () =>
      exportCsv("TECHNOLOGY_SUPPORT"),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("an export request arrives", () =>
      exportCsv("TECHNOLOGY_SUPPORT", { from: "2026-06-01", to: "2026-06-08" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is exported", () =>
      expect(getTeamReport).not.toHaveBeenCalled(),
    );
  });
});
