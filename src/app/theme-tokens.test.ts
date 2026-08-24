/**
 * Guards the APEX colour contract. These are the rules that are cheap to
 * break by hand and expensive to notice by eye -- particularly a token added
 * to light mode and forgotten in dark, which only shows up as an unreadable
 * panel once someone toggles the theme.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { AA_NORMAL_TEXT, contrastRatio } from "@/test/contrast";

const REPO_ROOT = path.resolve(__dirname, "../..");
const globalsCss = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
const tailwindConfig = readFileSync(path.join(REPO_ROOT, "tailwind.config.ts"), "utf8");

/** Pulls the `--token: value;` declarations out of a single CSS block. */
function tokensIn(selector: string): Map<string, string> {
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(globalsCss);
  if (!block) throw new Error(`No ${selector} block found in globals.css`);
  const tokens = new Map<string, string>();
  const body = block[1] ?? "";
  for (const match of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) tokens.set(name, value.trim());
  }
  return tokens;
}

/** Every .tsx file under a directory, recursively. */
function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** Tokens that are structural, not colours, so they need no dark variant. */
const NON_COLOUR_TOKENS = new Set(["radius"]);

feature("APEX colour tokens", () => {
  scenario(
    "Every colour token defined for light mode is also defined for dark",
    async (s) => {
      const light = await s.given("the light-mode token block", () => tokensIn(":root"));
      const dark = await s.given("the dark-mode token block", () => tokensIn("\\.dark"));

      const missing = await s.when("comparing the two sets", () =>
        [...light.keys()].filter(
          (name) => !NON_COLOUR_TOKENS.has(name) && !dark.has(name),
        ),
      );

      await s.then("no colour token is missing a dark value", () => {
        expect(missing).toEqual([]);
      });
    },
  );

  scenario("Dark mode introduces no token that light mode lacks", async (s) => {
    const light = await s.given("the light-mode token block", () => tokensIn(":root"));
    const dark = await s.given("the dark-mode token block", () => tokensIn("\\.dark"));

    const orphans = await s.when("looking for dark-only tokens", () =>
      [...dark.keys()].filter((name) => !light.has(name)),
    );

    await s.then("every dark token has a light counterpart", () => {
      expect(orphans).toEqual([]);
    });
  });

  scenario("Theming is class-based, as in APEX", async (s) => {
    await s.then("dark mode is driven by a class, not a media query", () => {
      expect(tailwindConfig).toMatch(/darkMode:\s*\["class"\]/);
      // Matches the construct, not the word -- the token block's own comment
      // mentions prefers-color-scheme to explain why it is not used.
      expect(globalsCss).not.toMatch(/@media[^{]*prefers-color-scheme/);
    });
  });

  scenario("Colour tokens stay opacity-modifier capable", async (s) => {
    const light = await s.given("the light-mode token block", () => tokensIn(":root"));

    // Stored as bare oklch components so tailwind.config.ts can wrap them as
    // `oklch(var(--x) / <alpha-value>)`. --border and --input are deliberate
    // exceptions holding complete colours (APEX gives them alpha in dark).
    const COMPLETE_COLOUR_TOKENS = new Set(["border", "input"]);

    await s.then("component-form tokens are three bare numbers", () => {
      for (const [name, value] of light) {
        if (NON_COLOUR_TOKENS.has(name) || COMPLETE_COLOUR_TOKENS.has(name)) continue;
        expect(value, `--${name} should be bare oklch components`).toMatch(
          /^[\d.]+\s+[\d.]+\s+[\d.]+$/,
        );
      }
    });

    await s.and("the Tailwind config threads the alpha channel through", () => {
      expect(tailwindConfig).toContain("<alpha-value>");
      expect(tailwindConfig).not.toContain("hsl(");
    });
  });
});

/**
 * The `X` / `X-foreground` pairs that really get painted on top of each other
 * (`bg-warning text-warning-foreground` and friends). `muted` is deliberately
 * absent: `--muted-foreground` is APEX's secondary *body* text colour, sitting
 * on `background` or `card` rather than on `bg-muted`, and its contract is
 * pinned by its own scenario below.
 */
const SOLID_PAIRS = [
  "background",
  "card",
  "popover",
  "primary",
  "secondary",
  "accent",
  "destructive",
  "success",
  "warning",
] as const;

feature("APEX colour contrast", () => {
  scenario.each(["light", "dark"] as const)(
    "Solid foreground/background pairs meet WCAG AA in %s mode",
    async (mode, s) => {
      const tokens = await s.given(`the ${mode} token block`, () =>
        tokensIn(mode === "light" ? ":root" : "\\.dark"),
      );

      const failures = await s.when("measuring each solid pair", () =>
        SOLID_PAIRS.flatMap((name) => {
          const background = tokens.get(name);
          const foreground = tokens.get(`${name}-foreground`);
          if (!background || !foreground) return [];
          const ratio = contrastRatio(background, foreground);
          return ratio < AA_NORMAL_TEXT
            ? [`--${name} / --${name}-foreground is ${ratio.toFixed(2)}:1`]
            : [];
        }),
      );

      await s.then("every pair clears 4.5:1 for normal text", () => {
        expect(failures).toEqual([]);
      });
    },
  );

  /*
   * The token pair check above cannot see this: `--muted-foreground` is
   * legitimately low-contrast against `--muted` (3.81:1 light, 3.98:1 dark),
   * which is fine while it stays on `background`/`card`. Putting the two on the
   * same element is the mistake, and axe only catches it on a page a spec
   * happens to visit -- so guard it at the source instead.
   */
  scenario("No element pairs bg-muted with text-muted-foreground", async (s) => {
    const files = await s.given("every component and page source file", () =>
      tsxFilesUnder(path.join(REPO_ROOT, "src")),
    );

    const offenders = await s.when("looking for the pairing in one class list", () =>
      files.flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return [...source.matchAll(/className="([^"]*)"/g)]
          .filter(
            ([, classes]) =>
              /\bbg-muted\b/.test(classes as string) &&
              /\btext-muted-foreground\b/.test(classes as string),
          )
          .map(() => path.relative(REPO_ROOT, file));
      }),
    );

    await s.then("no element carries both classes", () => {
      expect(offenders).toEqual([]);
    });
  });

  scenario.each(["light", "dark"] as const)(
    "Secondary body text is readable on the surfaces it sits on in %s mode",
    async (mode, s) => {
      const tokens = await s.given(`the ${mode} token block`, () =>
        tokensIn(mode === "light" ? ":root" : "\\.dark"),
      );

      await s.then("--muted-foreground clears AA on background and card", () => {
        for (const surface of ["background", "card"]) {
          const ratio = contrastRatio(
            tokens.get(surface) as string,
            tokens.get("muted-foreground") as string,
          );
          expect(ratio, `--muted-foreground on --${surface}`).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT,
          );
        }
      });
    },
  );
});
