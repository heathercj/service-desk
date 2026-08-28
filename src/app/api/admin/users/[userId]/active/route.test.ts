/**
 * Behaviour of the user activate/deactivate endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/admin/admin-service", () => ({ setUserActive: vi.fn() }));

const { setUserActive } = await import("@/lib/admin/admin-service");
const { POST } = await import("./route");

const USER_ID = "44444444-0000-4000-8000-000000000002";

function toggle(body: unknown) {
  return readResponse(
    POST(
      jsonRequest(`/api/admin/users/${USER_ID}/active`, body),
      routeContext({ userId: USER_ID }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(setUserActive).mockReset();
  signOut();
});

feature("Activating and deactivating a user", () => {
  scenario("An administrator deactivates a terminated agent", async (s) => {
    const admin = await s.given("a signed-in administrator", () => {
      const actor = actors.administrator();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the change", () => {
      vi.mocked(setUserActive).mockResolvedValue({
        id: USER_ID,
        isActive: false,
      } as Awaited<ReturnType<typeof setUserActive>>);
    });

    const res = await s.when("they deactivate the agent", () =>
      toggle({ isActive: false }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity and the target", () => {
      expect(setUserActive).toHaveBeenCalledWith(
        expect.objectContaining({ userId: admin.userId }),
        USER_ID,
        false,
      );
    });
  });

  scenario("An administrator cannot deactivate their own account", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    await s.and("the service refuses self-deactivation", () => {
      vi.mocked(setUserActive).mockRejectedValue(
        new ForbiddenError("You cannot deactivate your own account"),
      );
    });

    const res = await s.when("they attempt to deactivate themselves", () =>
      toggle({ isActive: false }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A non-administrator cannot deactivate anyone", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the service refuses non-administrators", () => {
      vi.mocked(setUserActive).mockRejectedValue(
        new ForbiddenError("Administrator access required"),
      );
    });

    const res = await s.when("they attempt to deactivate an agent", () =>
      toggle({ isActive: false }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed payload is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they send a non-boolean value", () =>
      toggle({ isActive: "yes" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing changes", () => expect(setUserActive).not.toHaveBeenCalled());
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a deactivation request arrives", () =>
      toggle({ isActive: false }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing changes", () => expect(setUserActive).not.toHaveBeenCalled());
  });
});
