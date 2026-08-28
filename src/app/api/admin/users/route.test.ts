/**
 * Behaviour of the agent-provisioning endpoint: admin-only, validated
 * email, no route-owned business logic beyond that.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/admin/admin-service", () => ({ provisionUserByEmail: vi.fn() }));

const { provisionUserByEmail } = await import("@/lib/admin/admin-service");
const { POST } = await import("./route");

function addAgent(body: unknown) {
  return readResponse(POST(jsonRequest("/api/admin/users", body)));
}

beforeEach(() => {
  vi.mocked(provisionUserByEmail).mockReset();
  signOut();
});

feature("Provisioning an agent by email", () => {
  scenario("An administrator provisions a new agent", async (s) => {
    const admin = await s.given("a signed-in administrator", () => {
      const actor = actors.administrator();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service finds them in the directory", () => {
      vi.mocked(provisionUserByEmail).mockResolvedValue({
        id: "new-user-id",
        email: "new.hire@alairhomes.com",
      } as Awaited<ReturnType<typeof provisionUserByEmail>>);
    });

    const res = await s.when("they provision by email", () =>
      addAgent({ email: "new.hire@alairhomes.com" }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity and the email", () => {
      expect(provisionUserByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ userId: admin.userId }),
        "new.hire@alairhomes.com",
      );
    });
  });

  scenario("A non-administrator cannot provision an agent", async (s) => {
    await s.given("a signed-in department manager", () =>
      setCurrentActor(actors.departmentManager()),
    );

    await s.and("the service refuses non-administrators", () => {
      vi.mocked(provisionUserByEmail).mockRejectedValue(
        new ForbiddenError("Administrator access required"),
      );
    });

    const res = await s.when("they attempt to provision an agent", () =>
      addAgent({ email: "someone@alairhomes.com" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("No matching account exists in the directory", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    await s.and("the service finds no match", () => {
      vi.mocked(provisionUserByEmail).mockRejectedValue(
        new NotFoundError("No matching account found in the directory for that email"),
      );
    });

    const res = await s.when("they attempt to provision an unknown email", () =>
      addAgent({ email: "nobody@alairhomes.com" }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("A malformed payload is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they send a non-email value", () =>
      addAgent({ email: "not-an-email" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is provisioned", () =>
      expect(provisionUserByEmail).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a provisioning request arrives", () =>
      addAgent({ email: "someone@alairhomes.com" }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is provisioned", () =>
      expect(provisionUserByEmail).not.toHaveBeenCalled(),
    );
  });
});
