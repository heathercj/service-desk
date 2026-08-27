/**
 * Behaviour of the notification-preferences save endpoint: staff-only,
 * validated boolean toggles, no route-owned business logic beyond that.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/notifications/preferences-service", () => ({
  updateNotificationPreferences: vi.fn(),
}));

const { updateNotificationPreferences } = await import(
  "@/lib/notifications/preferences-service"
);
const { PUT } = await import("./route");

const VALID_BODY = {
  ticketAssignedEmail: false,
  ticketCommentedEmail: true,
  knowledgeArticlePublishedEmail: true,
};

function save(body: unknown) {
  return readResponse(
    PUT(jsonRequest("/api/settings/notifications", body, { method: "PUT" })),
  );
}

beforeEach(() => {
  vi.mocked(updateNotificationPreferences).mockReset();
  signOut();
});

feature("Saving notification preferences", () => {
  scenario("A signed-in agent saves their preferences", async (s) => {
    const agent = await s.given("a signed-in department agent", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the update", () => {
      vi.mocked(updateNotificationPreferences).mockResolvedValue(
        VALID_BODY as Awaited<ReturnType<typeof updateNotificationPreferences>>,
      );
    });

    const res = await s.when("they save their preferences", () => save(VALID_BODY));

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity and the new values", () => {
      expect(updateNotificationPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        VALID_BODY,
      );
    });
  });

  scenario("A customer cannot save notification preferences", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses non-staff actors", () => {
      vi.mocked(updateNotificationPreferences).mockRejectedValue(
        new ForbiddenError("You cannot manage notification preferences"),
      );
    });

    const res = await s.when("they attempt to save", () => save(VALID_BODY));

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed payload is rejected", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    const res = await s.when("they send a non-boolean value", () =>
      save({ ...VALID_BODY, ticketAssignedEmail: "yes" }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is saved", () =>
      expect(updateNotificationPreferences).not.toHaveBeenCalled(),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a save request arrives", () => save(VALID_BODY));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is saved", () =>
      expect(updateNotificationPreferences).not.toHaveBeenCalled(),
    );
  });
});
