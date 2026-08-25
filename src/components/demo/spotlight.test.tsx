/**
 * Behaviour of the spotlight's scrolling.
 *
 * The DOM driver already scrolls to what it is about to type into
 * (dom-drive.ts:186), which covers autopilot and "fill it in for me". Mode 1
 * -- Henry narrates, a human clicks -- went through no driver at all, so a
 * step whose anchor sat below the fold rang an element nobody could see and
 * the room waited on a cue with nothing to look at.
 *
 * jsdom implements no layout and no scrollIntoView, so these scenarios assert
 * the call rather than the resulting position; whether the element ends up
 * centred is the browser's job, and e2e's.
 */
import { beforeEach, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { feature, scenario } from "@/test/bdd";
import { Spotlight } from "./spotlight";

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = "";
});

/**
 * jsdom gives every element a 0x0 rect, which the spotlight reads as "hidden"
 * and refuses to ring -- so the element needs a size before any of this is
 * exercised at all. The offset is what a control below the fold looks like.
 */
function anchored(anchor: string): HTMLElement {
  const el = document.createElement("button");
  el.setAttribute("data-tour", anchor);
  el.getBoundingClientRect = () =>
    ({ top: 2_400, left: 40, width: 180, height: 32 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

feature("Spotlight scrolling", () => {
  scenario("A step whose anchor is off-screen brings it into view", async (s) => {
    await s.given("an anchored control on the page", () => anchored("ticket-consent"));

    await s.when("the spotlight points at it", () => {
      render(<Spotlight anchor="ticket-consent" />);
    });

    await s.then("the page is moved to it, centred", () => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: "center" }),
      );
    });
  });

  scenario(
    "A narration step with nothing to point at leaves the page alone",
    async (s) => {
      // Most of the tour is narration. Scrolling on those steps would yank the
      // page for no reason, and away from whatever the viewer was reading.
      await s.given("a page with anchors on it", () => anchored("ticket-consent"));

      await s.when("the spotlight has no anchor", () => {
        render(<Spotlight anchor={undefined} />);
      });

      await s.then("nothing scrolls", () =>
        expect(scrollIntoView).not.toHaveBeenCalled(),
      );
    },
  );

  scenario("Re-measuring the same anchor does not keep scrolling", async (s) => {
    // The spotlight re-measures on scroll, on mutation, and on a 400ms poll.
    // Scrolling from inside that loop would fight a viewer who scrolled away
    // to look at something else -- the demo must not trap the page.
    const view = await s.given("the spotlight already pointing at a control", () => {
      anchored("ticket-consent");
      return render(<Spotlight anchor="ticket-consent" />);
    });

    await s.when("the page is re-rendered for the same anchor", () => {
      view.rerender(<Spotlight anchor="ticket-consent" />);
      window.dispatchEvent(new Event("resize"));
    });

    await s.then("it scrolled only for the first arrival", () =>
      expect(scrollIntoView).toHaveBeenCalledTimes(1),
    );
  });
});
