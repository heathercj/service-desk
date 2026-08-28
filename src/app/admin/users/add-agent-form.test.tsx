/**
 * Behaviour of the "add an agent by email" form on /admin/users.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { AddAgentForm } from "./add-agent-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Add an agent by email", () => {
  scenario(
    "Provisioning a known email clears the field and refreshes the list",
    async (s) => {
      await s.given("the form, and a directory match for the email", () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "u1" }) });
        render(<AddAgentForm />);
      });

      await s.when("an administrator submits an email", async () => {
        await userEvent.type(
          screen.getByLabelText(/add an agent by email/i),
          "new.hire@alairhomes.com",
        );
        await userEvent.click(screen.getByRole("button", { name: /add agent/i }));
      });

      await s.then("it posts to the provisioning endpoint", () => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/admin/users",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ email: "new.hire@alairhomes.com" }),
          }),
        );
      });

      await s.and("the field is cleared and the list refreshed", () => {
        expect(screen.getByLabelText(/add an agent by email/i)).toHaveValue("");
        expect(refresh).toHaveBeenCalled();
      });
    },
  );

  scenario(
    "No directory match shows an inline error, and the field is not cleared",
    async (s) => {
      await s.given("the form, and no directory match for the email", () => {
        fetchMock.mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({
            error: "No matching account found in the directory for that email",
          }),
        });
        render(<AddAgentForm />);
      });

      await s.when("an administrator submits an unknown email", async () => {
        await userEvent.type(
          screen.getByLabelText(/add an agent by email/i),
          "nobody@alairhomes.com",
        );
        await userEvent.click(screen.getByRole("button", { name: /add agent/i }));
      });

      await s.then("the error is shown", () => {
        expect(screen.getByRole("alert")).toHaveTextContent(/no matching account/i);
      });

      await s.and(
        "the field still has what they typed, and nothing was refreshed",
        () => {
          expect(screen.getByLabelText(/add an agent by email/i)).toHaveValue(
            "nobody@alairhomes.com",
          );
          expect(refresh).not.toHaveBeenCalled();
        },
      );
    },
  );
});
