/**
 * Behaviour of the "rename a department" form on /admin/departments.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { RenameDepartmentForm } from "./rename-department-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Rename a department", () => {
  scenario("Saving a new name posts to the rename endpoint and refreshes", async (s) => {
    await s.given("the form pre-filled with the current name", () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "dept-1",
          key: "TECHNOLOGY_SUPPORT",
          name: "Tech Support",
        }),
      });
      render(<RenameDepartmentForm departmentId="dept-1" name="Technology Support" />);
    });

    await s.when("an administrator changes the name and saves", async () => {
      const input = screen.getByLabelText(/department name/i);
      await userEvent.clear(input);
      await userEvent.type(input, "Tech Support");
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await s.then("it posts to the rename endpoint", () => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/departments/dept-1/rename",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Tech Support" }),
        }),
      );
    });

    await s.and("the list is refreshed", () => expect(refresh).toHaveBeenCalled());
  });

  scenario("An error is shown inline and the typed name is kept", async (s) => {
    await s.given("the form, and the service refuses the new name", () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: "Department name must be between 1 and 60 characters",
        }),
      });
      render(<RenameDepartmentForm departmentId="dept-1" name="Technology Support" />);
    });

    await s.when("an administrator submits a name the server rejects", async () => {
      const input = screen.getByLabelText(/department name/i);
      await userEvent.clear(input);
      await userEvent.type(input, "x".repeat(61));
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await s.then("the error is shown", () => {
      expect(screen.getByRole("alert")).toHaveTextContent(/must be between/i);
    });

    await s.and("nothing was refreshed", () => expect(refresh).not.toHaveBeenCalled());
  });
});
