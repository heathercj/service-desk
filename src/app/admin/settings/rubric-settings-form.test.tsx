/**
 * Behaviour of the Product Operating Model rubric settings form on
 * /admin/settings.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { RubricSettingsForm } from "./rubric-settings-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

const RUBRIC = {
  targetHoursByPriority: { URGENT: 8, HIGH: 24, MEDIUM: 72, LOW: 120 },
  graceHours: 72,
};

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Adjusting the product-signal rubric", () => {
  scenario("An administrator changes the URGENT target and saves", async (s) => {
    await s.given("the form pre-filled with the current rubric", () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => RUBRIC });
      render(<RubricSettingsForm rubric={RUBRIC} />);
    });

    await s.when("they change the URGENT target hours and save", async () => {
      const input = screen.getByLabelText(/urgent/i);
      await userEvent.clear(input);
      await userEvent.type(input, "4");
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await s.then("it posts the full rubric with the changed value", () => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/settings/rubric",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            targetHoursByPriority: { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 120 },
            graceHours: 72,
          }),
        }),
      );
    });

    await s.and("the list is refreshed", () => expect(refresh).toHaveBeenCalled());
  });

  scenario("An invalid value is refused and the error is shown inline", async (s) => {
    await s.given("the form, and the service refuses the change", () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "Invalid rubric" }),
      });
      render(<RubricSettingsForm rubric={RUBRIC} />);
    });

    await s.when("an administrator saves", async () => {
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await s.then("the error is shown", () => {
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid rubric/i);
    });

    await s.and("nothing was refreshed", () => expect(refresh).not.toHaveBeenCalled());
  });
});
