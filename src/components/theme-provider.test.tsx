/**
 * The theme provider's whole job is configuration, and that configuration is
 * load-bearing: globals.css keys its dark token block off a `.dark` class on
 * <html>, so `attribute="class"` is a contract between this file and the
 * stylesheet, not a preference. next-themes is stubbed to capture the props
 * it is handed.
 */
import { expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { feature, scenario } from "@/test/bdd";

let received: Record<string, unknown> = {};

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    received = props;
    return <div data-testid="next-themes">{children}</div>;
  },
}));

const { ThemeProvider } = await import("./theme-provider");

feature("Theme provider", () => {
  scenario("Theming is applied as a class, the way the stylesheet expects", async (s) => {
    await s.given("the app is wrapped in the theme provider", () => {
      render(
        <ThemeProvider>
          <p>App</p>
        </ThemeProvider>,
      );
    });

    await s.then("the theme is carried as a class attribute", () => {
      expect(received.attribute).toBe("class");
    });

    await s.and("a first-time visitor gets their operating system preference", () => {
      expect(received.defaultTheme).toBe("system");
      expect(received.enableSystem).toBe(true);
    });

    await s.and("flipping the theme does not animate every colour at once", () => {
      expect(received.disableTransitionOnChange).toBe(true);
    });

    await s.and("the app renders inside it", () => {
      expect(screen.getByText("App")).toBeInTheDocument();
    });
  });
});
