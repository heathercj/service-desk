/**
 * Behaviour of the per-department Member/Manager toggles on /admin/users.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { DepartmentMembershipToggles } from "./department-membership-toggles";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

const DEPARTMENTS = [
  { id: "dept-tech", name: "Technology Support" },
  { id: "dept-training", name: "Training" },
];

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Department membership toggles", () => {
  scenario("It reflects existing membership and manager status", async (s) => {
    await s.given("a user who manages Technology Support but isn't in Training", () => {
      render(
        <DepartmentMembershipToggles
          userId="u1"
          currentMemberships={[{ departmentId: "dept-tech", isManager: true }]}
          allDepartments={DEPARTMENTS}
        />,
      );
    });

    await s.then("Technology Support shows member and manager checked", () => {
      const [techMember, techManager] = screen.getAllByRole("checkbox").slice(0, 2);
      expect(techMember).toBeChecked();
      expect(techManager).toBeChecked();
    });

    await s.and("Training shows neither checked, and its manager box is disabled", () => {
      const [trainingMember, trainingManager] = screen
        .getAllByRole("checkbox")
        .slice(2, 4);
      expect(trainingMember).not.toBeChecked();
      expect(trainingManager).not.toBeChecked();
      expect(trainingManager).toBeDisabled();
    });
  });

  scenario("Granting membership posts member-on, manager-off", async (s) => {
    await s.given("a user in neither department", () => {
      render(
        <DepartmentMembershipToggles
          userId="u1"
          currentMemberships={[]}
          allDepartments={DEPARTMENTS}
        />,
      );
    });

    await s.when("an administrator checks Training's member box", async () => {
      const [, , trainingMember] = screen.getAllByRole("checkbox");
      await userEvent.click(trainingMember!);
    });

    await s.then("it posts membership on, manager off", () => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/users/u1/departments/dept-training",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ isMember: true, isManager: false }),
        }),
      );
    });
  });

  scenario("Revoking membership posts member-off, manager-off", async (s) => {
    await s.given("a user who manages Technology Support", () => {
      render(
        <DepartmentMembershipToggles
          userId="u1"
          currentMemberships={[{ departmentId: "dept-tech", isManager: true }]}
          allDepartments={DEPARTMENTS}
        />,
      );
    });

    await s.when("an administrator unchecks the member box", async () => {
      const [techMember] = screen.getAllByRole("checkbox");
      await userEvent.click(techMember!);
    });

    await s.then("it posts membership off, manager off", () => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/users/u1/departments/dept-tech",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ isMember: false, isManager: false }),
        }),
      );
    });
  });
});
