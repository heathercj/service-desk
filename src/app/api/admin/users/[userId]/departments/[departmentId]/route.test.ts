/**
 * Behaviour of the department-membership assignment endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/admin/admin-service", () => ({ setDepartmentMembership: vi.fn() }));

const { setDepartmentMembership } = await import("@/lib/admin/admin-service");
const { POST } = await import("./route");

const USER_ID = "44444444-0000-4000-8000-000000000003";
const DEPARTMENT_ID = "55555555-0000-4000-8000-000000000001";

function assign(body: unknown) {
  return readResponse(
    POST(
      jsonRequest(`/api/admin/users/${USER_ID}/departments/${DEPARTMENT_ID}`, body),
      routeContext({ userId: USER_ID, departmentId: DEPARTMENT_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(setDepartmentMembership).mockReset();
  signOut();
});

feature("Assigning department membership", () => {
  scenario("An administrator grants membership with the manager flag", async (s) => {
    const admin = await s.given("a signed-in administrator", () => {
      const actor = actors.administrator();
      setCurrentActor(actor);
      return actor;
    });

    const res = await s.when("they grant membership and manager status", () =>
      assign({ isMember: true, isManager: true }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity and the desired state", () => {
      expect(setDepartmentMembership).toHaveBeenCalledWith(
        expect.objectContaining({ userId: admin.userId }),
        USER_ID,
        DEPARTMENT_ID,
        { isMember: true, isManager: true },
      );
    });
  });

  scenario("A non-administrator cannot assign department membership", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the service refuses non-administrators", () => {
      vi.mocked(setDepartmentMembership).mockRejectedValue(
        new ForbiddenError("Administrator access required"),
      );
    });

    const res = await s.when("they attempt to grant membership", () =>
      assign({ isMember: true, isManager: false }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed payload is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they omit the manager flag", () =>
      assign({ isMember: true }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing changes", () =>
      expect(setDepartmentMembership).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("an assignment request arrives", () =>
      assign({ isMember: true, isManager: false }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing changes", () =>
      expect(setDepartmentMembership).not.toHaveBeenCalled(),
    );
  });
});
