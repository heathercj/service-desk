/**
 * Row scoping, which is the part of the tour that breaks quietly.
 *
 * A demo machine accumulates records: by the tenth run the knowledge console
 * holds a dozen drafts and the queue a dozen tickets. Anything that resolves
 * an anchor without narrowing to the RIGHT row silently watches somebody
 * else's, and the tour stalls on a step that looks like it should have
 * worked. That is a real stall this suite was written after.
 */
import { expect } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { queryAnchor, queryScopedRow, setNativeValue } from "./dom-drive";

function render(html: string) {
  document.body.innerHTML = html;
}

/** Three article rows, ours in the middle, the first still a draft. */
const MANAGE_CONSOLE = `
  <div data-tour="article-row">Somebody else's draft <span>DRAFT</span>
    <button data-tour="article-publish">Publish</button></div>
  <div data-tour="article-row">Buildertrend henry123 change order <span>PUBLISHED</span>
    <button data-tour="article-publish">Publish</button></div>
  <div data-tour="article-row">A third article <span>DRAFT</span>
    <button data-tour="article-publish">Publish</button></div>
`;

feature("Anchor resolution", () => {
  scenario("An unscoped anchor resolves the only one on the page", async (s) => {
    await s.given("a page with a single anchor", () =>
      render('<input data-tour="ticket-subject" />'),
    );
    await s.then("it is found", () =>
      expect(queryAnchor("ticket-subject")).toBeInstanceOf(HTMLInputElement),
    );
  });

  scenario("A scoped anchor picks the control in the matching row", async (s) => {
    await s.given("a console holding three article rows", () => render(MANAGE_CONSOLE));

    const button = await s.when("the anchor is scoped to our article's title", () =>
      queryAnchor("article-publish", {
        anchor: "article-row",
        containing: "henry123",
      }),
    );

    await s.then("it is the button inside our row, not the first row's", () => {
      expect(button).not.toBeNull();
      expect(button?.closest("[data-tour='article-row']")?.textContent).toContain(
        "henry123",
      );
    });
  });

  scenario("A scope with no matching row resolves to nothing", async (s) => {
    // Better to return null and let the tour keep waiting than to fall back
    // to the first row and act on the wrong record.
    await s.given("a console with three rows", () => render(MANAGE_CONSOLE));
    await s.then("an unmatched scope finds nothing", () =>
      expect(
        queryAnchor("article-publish", {
          anchor: "article-row",
          containing: "never-published-this",
        }),
      ).toBeNull(),
    );
  });

  scenario("The scoped row itself is addressable", async (s) => {
    // The publish beat watches the row's own status badge, so it needs the
    // row -- not a control inside it. Resolving the first row instead is
    // exactly what stalled the tour: row one says DRAFT forever.
    await s.given("a console where the FIRST row is still a draft", () =>
      render(MANAGE_CONSOLE),
    );

    const row = await s.when("our row is resolved by title", () =>
      queryScopedRow({ anchor: "article-row", containing: "henry123" }),
    );

    await s.then("it reports our status, not the first row's", () => {
      expect(row?.textContent).toContain("PUBLISHED");
      expect(row?.textContent).not.toContain("Somebody else's draft");
    });
  });
});

feature("Driving a React-controlled field", () => {
  scenario("Setting a value notifies React", async (s) => {
    // Assigning el.value directly is invisible to React, which keeps its own
    // copy and wipes the change on the next render. Autopilot depends
    // entirely on the native setter plus a bubbling input event.
    const seen: string[] = [];
    const input = await s.given("an input with an input listener", () => {
      render('<input data-tour="subject" />');
      const el = document.querySelector<HTMLInputElement>("input")!;
      el.addEventListener("input", () => seen.push(el.value));
      return el;
    });

    await s.when("a value is set through the native setter", () =>
      setNativeValue(input, "Buildertrend henry123"),
    );

    await s.then("the field holds it", () =>
      expect(input.value).toBe("Buildertrend henry123"),
    );
    await s.and("a bubbling input event carried it", () =>
      expect(seen).toEqual(["Buildertrend henry123"]),
    );
  });
});
