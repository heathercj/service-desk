/**
 * Behaviour of the "create a department" form on /admin/departments.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { CreateDepartmentForm } from "./create-department-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Create a department", () => {
  scenario(
    "Creating a department clears the field, refreshes the list, and points at assigning staff",
    async (s) => {
      await s.given("the form, and the service accepts the name", () => {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "dept-new",
            key: "ALAIR_PERFORMANCE_TEAM",
            name: "Alair Performance Team",
          }),
        });
        render(<CreateDepartmentForm />);
      });

      await s.when("an administrator submits a name", async () => {
        await userEvent.type(
          screen.getByLabelText(/department name/i),
          "Alair Performance Team",
        );
        await userEvent.click(screen.getByRole("button", { name: /create/i }));
      });

      await s.then("it posts to the department-creation endpoint", () => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/admin/departments",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ name: "Alair Performance Team" }),
          }),
        );
      });

      await s.and("the field is cleared and the list refreshed", () => {
        expect(screen.getByLabelText(/department name/i)).toHaveValue("");
        expect(refresh).toHaveBeenCalled();
      });

      await s.and("a note points the administrator at assigning staff", () => {
        expect(screen.getByText(/assign staff/i)).toBeInTheDocument();
      });
    },
  );

  scenario(
    "A colliding name shows an inline error, and the field is not cleared",
    async (s) => {
      await s.given(
        "the form, and a name that collides with an existing department",
        () => {
          fetchMock.mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({
              error: "A department with a similar name already exists",
            }),
          });
          render(<CreateDepartmentForm />);
        },
      );

      await s.when("an administrator submits the colliding name", async () => {
        await userEvent.type(screen.getByLabelText(/department name/i), "Legal");
        await userEvent.click(screen.getByRole("button", { name: /create/i }));
      });

      await s.then("the error is shown", () => {
        expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
      });

      await s.and(
        "the field still has what they typed, and nothing was refreshed",
        () => {
          expect(screen.getByLabelText(/department name/i)).toHaveValue("Legal");
          expect(refresh).not.toHaveBeenCalled();
        },
      );
    },
  );
});
