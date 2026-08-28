/**
 * Behaviour of the per-user Activate/Deactivate control on /admin/users.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { UserActiveToggle } from "./user-active-toggle";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("User activate/deactivate control", () => {
  scenario("An active agent can be deactivated", async (s) => {
    await s.given("an active agent's row", () => {
      render(<UserActiveToggle userId="u1" isActive={true} isSelf={false} />);
    });

    await s.when("an administrator deactivates them", () =>
      userEvent.click(screen.getByRole("button", { name: /deactivate/i })),
    );

    await s.then("it posts isActive: false", () => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/users/u1/active",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ isActive: false }),
        }),
      );
    });
  });

  scenario("An inactive agent's row offers Activate instead", async (s) => {
    await s.given("a deactivated agent's row", () => {
      render(<UserActiveToggle userId="u1" isActive={false} isSelf={false} />);
    });

    await s.then("the control reads Activate", () => {
      expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument();
    });
  });

  scenario("An administrator's own row offers no control at all", async (s) => {
    await s.given("the signed-in administrator's own row", () => {
      render(<UserActiveToggle userId="u1" isActive={true} isSelf={true} />);
    });

    await s.then("no activate/deactivate button is offered", () => {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
