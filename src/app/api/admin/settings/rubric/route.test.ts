/**
 * Behaviour of the Product Operating Model rubric settings endpoint.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse } from "@/test/route-harness";
import { ForbiddenError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/reports/rubric-settings-service", () => ({ saveRubric: vi.fn() }));

const { saveRubric } = await import("@/lib/reports/rubric-settings-service");
const { POST } = await import("./route");

function save(body: unknown) {
  return readResponse(POST(jsonRequest("/api/admin/settings/rubric", body)));
}

const VALID_RUBRIC = {
  targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72, LOW: 120 },
  graceHours: 72,
};

beforeEach(() => {
  vi.mocked(saveRubric).mockReset();
  signOut();
});

feature("Saving the Product Operating Model rubric", () => {
  scenario("An administrator saves a new rubric", async (s) => {
    const admin = await s.given("a signed-in administrator", () => {
      const actor = actors.administrator();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts it", () => {
      vi.mocked(saveRubric).mockResolvedValue(VALID_RUBRIC);
    });

    const res = await s.when("they save the rubric", () => save(VALID_RUBRIC));

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the service is called with their identity and the rubric", () => {
      expect(saveRubric).toHaveBeenCalledWith(
        expect.objectContaining({ userId: admin.userId }),
        VALID_RUBRIC,
      );
    });
  });

  scenario("A product manager cannot save the rubric", async (s) => {
    await s.given("a signed-in product manager", () =>
      setCurrentActor(actors.productManager()),
    );

    await s.and("the service refuses non-administrators", () => {
      vi.mocked(saveRubric).mockRejectedValue(
        new ForbiddenError("Administrator access required"),
      );
    });

    const res = await s.when("they attempt to save the rubric", () => save(VALID_RUBRIC));

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A malformed rubric is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they submit a rubric missing a priority tier", () =>
      save({
        targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72 },
        graceHours: 72,
      }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
    await s.and("nothing is saved", () => expect(saveRubric).not.toHaveBeenCalled());
  });

  scenario("A non-positive hour value is rejected", async (s) => {
    await s.given("a signed-in administrator", () =>
      setCurrentActor(actors.administrator()),
    );

    const res = await s.when("they submit a zero-hour target", () =>
      save({
        targetHoursByPriority: { URGENT: 0, HIGH: 24, MEDIUM: 72, LOW: 120 },
        graceHours: 72,
      }),
    );

    await s.then("the request is rejected as invalid", () =>
      expect(res.status).toBe(400),
    );
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a save request arrives", () => save(VALID_RUBRIC));

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));
    await s.and("nothing is saved", () => expect(saveRubric).not.toHaveBeenCalled());
  });
});
