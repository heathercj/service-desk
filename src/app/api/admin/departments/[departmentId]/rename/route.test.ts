/**
 * Behaviour of the department-rename endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/admin/admin-service", () => ({ renameDepartment: vi.fn() }));

const { renameDepartment } = await import("@/lib/admin/admin-service");
const { POST } = await import("./route");

function rename(departmentId: string, body: unknown) {
  return readResponse(
    POST(
      jsonRequest(`/api/admin/departments/${departmentId}/rename`, body),
      routeContext({ departmentId }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(renameDepartment).mockReset();
  signOut();
});

feature("Renaming a department", () => {
  scenario("An administrator renames a department", async (s) => {
    const admin = await s.given("a signed-in administrator", () => {
      const actor = actors.administrator();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the new name", () => {
      vi.mocked(renameDepartment).mockResolvedValue({
        id: "dept-1",
        key: "TECHNOLOGY_SUPPORT",
        name: "Tech Support",
      } as Awaited<ReturnType<typeof renameDepartment>>);
    });

    const res = await s.when("they rename a department", () =>
      rename("dept-1", { name: "Tech Support" }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity, the id, and the name", () => {
      expect(renameDepartment).toHaveBeenCalledWith(
        expect.objectContaining({ userId: admin.userId }),
        "dept-1",
        "Tech Support",
      );
    });
  });

  scenario("A non-administrator cannot rename a department", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the service refuses non-administrators", () => {
      vi.mocked(renameDepartment).mockRejectedValue(
        new ForbiddenError("Administrator access required"),
      );
    });

    const res = await s.when("they attempt to rename a department", () =>
      rename("dept-1", { name: "Sneaky Rename" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed payload is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they send an empty name", () =>
      rename("dept-1", { name: "" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is renamed", () =>
      expect(renameDepartment).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a rename request arrives", () =>
      rename("dept-1", { name: "Tech Support" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is renamed", () =>
      expect(renameDepartment).not.toHaveBeenCalled(),
    );
  });
});
