/**
 * Behaviour of the user-submitted-URL renderer (Section 15).
 *
 * The security properties here are the whole point of the component, so they
 * are asserted directly: the link is never fetched or previewed, it opts out
 * of window.opener and referrer leakage, and the hostname is surfaced so a
 * reader can judge where it points before clicking.
 */
import { expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { feature, scenario } from "@/test/bdd";
import { SafeExternalLink } from "./safe-external-link";

feature("User-submitted external link", () => {
  scenario("An agent sees where a customer's link actually points", async (s) => {
    await s.given("a customer supplied a link to an unfamiliar host");

    const link = await s.when("the agent views the ticket", () => {
      render(
        <SafeExternalLink
          url="https://cdn.example.net/screens/vpn-error.png"
          hostname="cdn.example.net"
        />,
      );
      return screen.getByRole("link");
    });

    await s.then("the full URL is shown verbatim, not shortened or masked", () => {
      expect(link).toHaveTextContent("https://cdn.example.net/screens/vpn-error.png");
      expect(link).toHaveAttribute(
        "href",
        "https://cdn.example.net/screens/vpn-error.png",
      );
    });

    await s.and("the hostname is called out as user-submitted", () => {
      expect(screen.getByText("User-submitted · cdn.example.net")).toBeInTheDocument();
    });

    await s.and(
      "following it cannot reach back into the app or leak the referrer",
      () => {
        expect(link).toHaveAttribute("target", "_blank");
        const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
        expect(rel).toContain("noopener");
        expect(rel).toContain("noreferrer");
        expect(rel).toContain("nofollow");
      },
    );
  });

  scenario("The link is inert -- nothing is fetched to render it", async (s) => {
    await s.given("no image or preview is requested for the URL");

    const container = await s.when("the link is rendered", () => {
      const { container } = render(
        <SafeExternalLink url="https://evil.example/probe" hostname="evil.example" />,
      );
      return container;
    });

    await s.then("no element that would issue a request is emitted", () => {
      expect(container.querySelector("img, iframe, object, embed, video")).toBeNull();
    });
  });
});
