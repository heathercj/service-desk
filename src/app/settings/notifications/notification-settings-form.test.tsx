/**
 * Behaviour of the agent-facing notification-preferences form: what a staff
 * member sees for the three toggles, and exactly what it posts when saved.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { NotificationSettingsForm } from "./notification-settings-form";

const fetchMock = vi.fn();

const ALL_ON = {
  ticketAssignedEmail: true,
  ticketCommentedEmail: true,
  knowledgeArticlePublishedEmail: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ALL_ON });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Notification preferences form", () => {
  scenario("It reflects the agent's saved preferences", async (s) => {
    await s.given("an agent who has turned off assignment emails", () => {
      render(
        <NotificationSettingsForm
          initialPreferences={{ ...ALL_ON, ticketAssignedEmail: false }}
        />,
      );
    });

    await s.then("the assignment toggle shows unchecked", () => {
      expect(
        screen.getByRole("checkbox", { name: /ticket is assigned to me/i }),
      ).not.toBeChecked();
    });

    await s.and("the other two toggles show checked", () => {
      expect(screen.getByRole("checkbox", { name: /customer comments/i })).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: /knowledge.*article.*published/i }),
      ).toBeChecked();
    });
  });

  scenario("Saving posts exactly the toggles shown on screen", async (s) => {
    await s.given("the form showing all three toggles on", () => {
      render(<NotificationSettingsForm initialPreferences={ALL_ON} />);
    });

    await s.when("the agent turns off the KB-published toggle and saves", async () => {
      await userEvent.click(
        screen.getByRole("checkbox", { name: /knowledge.*article.*published/i }),
      );
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await s.then("it puts the updated preferences to the settings endpoint", () => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/notifications",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ ...ALL_ON, knowledgeArticlePublishedEmail: false }),
        }),
      );
    });

    await s.and("it confirms the save", () => {
      expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
    });
  });
});
