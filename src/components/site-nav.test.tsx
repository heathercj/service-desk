/**
 * Behaviour of the primary navigation.
 *
 * The nav is the first place role gating is visible, so these scenarios pin
 * exactly which destinations each role is offered -- and, just as important,
 * which it is not. Authorisation itself lives in src/lib/rbac; this only
 * asserts the nav agrees with it.
 *
 * next-auth and next-themes are stubbed: signing out and theme switching are
 * their own behaviours, covered elsewhere.
 */
import { beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";

const signOut = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

const { SiteNav } = await import("./site-nav");

/** Link labels the nav can offer, so a scenario can assert absence too. */
const ALL_LINKS = [
  "My tickets",
  "Triage",
  "My department",
  "Search tickets",
  "Knowledge",
  "Admin",
] as const;

function navLinkNames() {
  return screen
    .getAllByRole("link")
    .map((el) => el.textContent?.trim() ?? "")
    .filter((label) => (ALL_LINKS as readonly string[]).includes(label));
}

beforeEach(() => signOut.mockReset());

feature("Primary navigation", () => {
  scenario("A signed-out visitor is offered no destinations", async (s) => {
    await s.given("nobody is signed in");

    await s.when("the header renders", () => {
      render(<SiteNav auth={null} />);
    });

    await s.then("only the wordmark is shown", () => {
      expect(
        screen.getByRole("link", { name: "Alair Homes Service Desk" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    await s.and("there is no navigation landmark to tab into", () => {
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    });

    await s.and("no way to sign out is offered", () => {
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });
  });

  scenario.each([
    { role: "CUSTOMER", offered: ["My tickets"] },
    { role: "TRIAGE_AGENT", offered: ["Triage", "Search tickets"] },
    { role: "DEPARTMENT_AGENT", offered: ["My department", "Search tickets"] },
    { role: "DEPARTMENT_MANAGER", offered: ["My department", "Search tickets"] },
    { role: "KNOWLEDGE_MANAGER", offered: ["Knowledge"] },
    {
      role: "ADMINISTRATOR",
      offered: ["Triage", "My department", "Search tickets", "Knowledge", "Admin"],
    },
  ])(
    "A $role is offered exactly their own destinations",
    async ({ role, offered }, s) => {
      await s.given(`a signed-in ${role}`);

      await s.when("the header renders", () => {
        render(<SiteNav auth={{ displayName: "Dana Agent", roles: [role] }} />);
      });

      await s.then("the destinations they hold are offered", () => {
        expect(navLinkNames().sort()).toEqual([...offered].sort());
      });

      await s.and("nothing outside their roles is offered", () => {
        for (const label of ALL_LINKS) {
          if (offered.includes(label)) continue;
          expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
        }
      });
    },
  );

  scenario("Holding two roles offers the union of their destinations", async (s) => {
    await s.given("an agent who both triages and manages knowledge");

    await s.when("the header renders", () => {
      render(
        <SiteNav
          auth={{ displayName: "Sam Both", roles: ["TRIAGE_AGENT", "KNOWLEDGE_MANAGER"] }}
        />,
      );
    });

    await s.then("both sets of destinations appear, without duplicates", () => {
      expect(navLinkNames().sort()).toEqual(
        ["Knowledge", "Search tickets", "Triage"].sort(),
      );
    });
  });

  scenario("The dev mailbox is reachable from any signed-in session", async (s) => {
    await s.given("a signed-in customer -- the least privileged role", () => {
      render(<SiteNav auth={{ displayName: "Casey Customer", roles: ["CUSTOMER"] }} />);
    });

    await s.then("the dev mailbox is offered regardless of role", () => {
      expect(screen.getByRole("link", { name: "Dev mailbox" })).toBeInTheDocument();
    });
  });

  scenario("A signed-in user can see who they are and sign out", async (s) => {
    await s.given("a signed-in customer", () => {
      render(<SiteNav auth={{ displayName: "Casey Customer", roles: ["CUSTOMER"] }} />);
    });

    await s.and("their name is shown", () => {
      expect(screen.getByText("Casey Customer")).toBeInTheDocument();
    });

    await s.and("the navigation is a labelled landmark", () => {
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    });

    await s.when("they sign out", () =>
      userEvent.click(screen.getByRole("button", { name: "Sign out" })),
    );

    await s.then("they are returned to the login page", () => {
      expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
    });
  });
});
