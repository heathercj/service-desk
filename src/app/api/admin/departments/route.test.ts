/**
 * Behaviour of the department-creation endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { ConflictError, ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/admin/admin-service", () => ({ createDepartment: vi.fn() }));

const { createDepartment } = await import("@/lib/admin/admin-service");
const { POST } = await import("./route");

function create(body: unknown) {
  return readResponse(POST(jsonRequest("/api/admin/departments", body)));
}

beforeEach(() => {
  vi.mocked(createDepartment).mockReset();
  signOut();
});

feature("Creating a department", () => {
  scenario("An administrator creates a new department", async (s) => {
    const admin = await s.given("a signed-in administrator", () => {
      const actor = actors.administrator();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the name", () => {
      vi.mocked(createDepartment).mockResolvedValue({
        id: "dept-1",
        key: "ALAIR_PERFORMANCE_TEAM",
        name: "Alair Performance Team",
      } as Awaited<ReturnType<typeof createDepartment>>);
    });

    const res = await s.when("they create a department", () =>
      create({ name: "Alair Performance Team" }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity and the name", () => {
      expect(createDepartment).toHaveBeenCalledWith(
        expect.objectContaining({ userId: admin.userId }),
        "Alair Performance Team",
      );
    });
  });

  scenario("A non-administrator cannot create a department", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the service refuses non-administrators", () => {
      vi.mocked(createDepartment).mockRejectedValue(
        new ForbiddenError("Administrator access required"),
      );
    });

    const res = await s.when("they attempt to create a department", () =>
      create({ name: "Shadow IT" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A colliding name is refused as a conflict", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    await s.and("the service finds the derived key already taken", () => {
      vi.mocked(createDepartment).mockRejectedValue(
        new ConflictError("A department with a similar name already exists"),
      );
    });

    const res = await s.when("they submit a colliding name", () =>
      create({ name: "Legal" }),
    );

    await s.then("the response is a conflict", () => expect(res.status).toBe(409));
  });

  scenario("A malformed payload is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they send an empty name", () => create({ name: "" }));

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is created", () =>
      expect(createDepartment).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a create request arrives", () =>
      create({ name: "Alair Performance Team" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is created", () =>
      expect(createDepartment).not.toHaveBeenCalled(),
    );
  });
});
