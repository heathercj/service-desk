/**
 * Behaviour of the light/dark switch.
 *
 * next-themes is stubbed so these scenarios describe the toggle's own
 * behaviour -- which way it sends the theme, and what it announces to a
 * screen reader -- rather than re-testing the library.
 */
import { beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";

const setTheme = vi.fn();
let resolvedTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme, setTheme }),
}));

const { ThemeToggle } = await import("./theme-toggle");

beforeEach(() => {
  setTheme.mockReset();
  resolvedTheme = "light";
});

feature("Theme toggle", () => {
  scenario("A user in light mode switches to dark", async (s) => {
    await s.given("the resolved theme is light", () => {
      resolvedTheme = "light";
    });

    const button = await s.and("the toggle is rendered", () => {
      render(<ThemeToggle />);
      return screen.getByRole("button");
    });

    await s.and("it offers to switch to dark", () => {
      expect(button).toHaveAccessibleName("Switch to dark theme");
    });

    await s.when("the user activates it", () => userEvent.click(button));

    await s.then("the theme is set to dark", () => {
      expect(setTheme).toHaveBeenCalledWith("dark");
    });
  });

  scenario("A user in dark mode switches back to light", async (s) => {
    await s.given("the resolved theme is dark", () => {
      resolvedTheme = "dark";
    });

    const button = await s.and("the toggle is rendered", () => {
      render(<ThemeToggle />);
      return screen.getByRole("button");
    });

    await s.and("it offers to switch to light", () => {
      expect(button).toHaveAccessibleName("Switch to light theme");
    });

    await s.when("the user activates it", () => userEvent.click(button));

    await s.then("the theme is set to light", () => {
      expect(setTheme).toHaveBeenCalledWith("light");
    });
  });

  scenario("The toggle is reachable by keyboard", async (s) => {
    const button = await s.given("the toggle is rendered", () => {
      render(<ThemeToggle />);
      return screen.getByRole("button");
    });

    await s.when("the user tabs to it and presses Enter", async () => {
      await userEvent.tab();
      expect(button).toHaveFocus();
      await userEvent.keyboard("{Enter}");
    });

    await s.then("the theme is switched", () => {
      expect(setTheme).toHaveBeenCalledWith("dark");
    });
  });
});
