/**
 * DOM plumbing for the guided tour: finding anchored elements, waiting for
 * them, and -- for autopilot -- driving them the way a human would.
 *
 * This is the one genuinely fiddly part of the feature. The tour runs INSIDE
 * the page rather than through Playwright, so it has to satisfy React's
 * synthetic event system rather than a browser automation driver.
 */

import type { DomDriver, ResolvedScope } from "./tour-types";

export const ANCHOR_ATTR = "data-tour";

export function anchorSelector(anchor: string): string {
  return `[${ANCHOR_ATTR}="${CSS.escape(anchor)}"]`;
}

/**
 * The repeated row a scope identifies -- the article row carrying THIS title,
 * the queue row for THIS ticket. Returns the row itself, which is what you
 * want when the thing being watched is the row's own text (a status badge)
 * rather than a control inside it.
 */
export function queryScopedRow(scope: ResolvedScope): HTMLElement | null {
  const rows = document.querySelectorAll<HTMLElement>(anchorSelector(scope.anchor));
  for (const row of rows) {
    if (row.textContent?.includes(scope.containing)) return row;
  }
  return null;
}

/**
 * Resolves an anchor, optionally narrowed to the repeated row whose text
 * identifies it. Returns null rather than throwing so callers can wait.
 */
export function queryAnchor(anchor: string, scope?: ResolvedScope): HTMLElement | null {
  if (!scope) return document.querySelector<HTMLElement>(anchorSelector(anchor));

  const rows = document.querySelectorAll<HTMLElement>(anchorSelector(scope.anchor));
  for (const row of rows) {
    if (!row.textContent?.includes(scope.containing)) continue;
    const hit = row.querySelector<HTMLElement>(anchorSelector(anchor));
    if (hit) return hit;
  }
  return null;
}

export function queryAllAnchors(anchor: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(anchorSelector(anchor)));
}

/**
 * Calls back once a predicate holds, re-checking on any DOM mutation and on a
 * slow poll. Returns a cleanup function.
 *
 * The poll is the safety net, not the belt: some things the tour waits on are
 * not mutations at all -- an input's `value` changing does not touch the
 * attribute, so MutationObserver never fires for it.
 */
export function observeUntil(
  predicate: () => boolean,
  onSatisfied: () => void,
  { pollMs = 200 }: { pollMs?: number } = {},
): () => void {
  if (predicate()) {
    // Already true: report it, but still hand back a no-op cleanup so
    // callers do not have to special-case the synchronous path.
    onSatisfied();
    return () => undefined;
  }

  let done = false;

  const check = () => {
    if (done || !predicate()) return;
    stop();
    onSatisfied();
  };

  const observer = new MutationObserver(check);
  const poll = setInterval(check, pollMs);

  // Declared as a hoisted function so `check` above can call it while the
  // handles it closes over stay const.
  function stop() {
    done = true;
    observer.disconnect();
    clearInterval(poll);
  }

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  return stop;
}

/** Promise form, for the autopilot driver. */
export function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 15_000, pollMs = 200 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error("Timed out waiting for the page to catch up"));
    }, timeoutMs);
    const stop = observeUntil(
      predicate,
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      { pollMs },
    );
  });
}

export async function waitForAnchor(
  anchor: string,
  scope?: ResolvedScope,
  timeoutMs = 15_000,
): Promise<HTMLElement> {
  await waitUntil(() => queryAnchor(anchor, scope) !== null, { timeoutMs });
  const el = queryAnchor(anchor, scope);
  if (!el) throw new Error(`Anchor "${anchor}" vanished after appearing`);
  return el;
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isTextField(el: Element): el is TextField {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/**
 * React tracks its own copy of an input's value, so assigning `el.value`
 * directly is invisible to it -- the component re-renders and wipes the
 * change straight back out. Going through the prototype's native setter and
 * then dispatching the event React actually listens for is what makes
 * autopilot work at all. Everything else here is ordinary DOM.
 */
export function setNativeValue(el: TextField, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("No native value setter -- cannot drive this field");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DomDriverOptions {
  /**
   * Per-character delay. 0 fills instantly.
   *
   * 50ms, up from ~18ms originally and 27ms after the first pass. Brisk
   * typing reads as a machine filling a form, and the room stops following
   * what is being typed and waits for it to stop. Slow enough to read along
   * with is the point -- the narration beside it is explaining what the words
   * mean, so the words have to still be arriving while it is read.
   */
  typeDelayMs?: number;
  /** Pause before a click, so the audience sees what is about to be hit. */
  clickDelayMs?: number;
  findTimeoutMs?: number;
}

export function createDomDriver({
  typeDelayMs = 50,
  clickDelayMs = 650,
  findTimeoutMs = 15_000,
}: DomDriverOptions = {}): DomDriver {
  async function focusInto(anchor: string, scope?: ResolvedScope) {
    const el = await waitForAnchor(anchor, scope, findTimeoutMs);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return el;
  }

  return {
    async type(anchor, text, scope) {
      const el = await focusInto(anchor, scope);
      if (!isTextField(el)) {
        throw new Error(`Anchor "${anchor}" is not a text field`);
      }
      el.focus();
      setNativeValue(el, "");
      // Character by character, so debounced listeners see the same
      // sequence of edits a real typist produces.
      let sofar = "";
      for (const ch of text) {
        sofar += ch;
        setNativeValue(el, sofar);
        if (typeDelayMs > 0) await sleep(typeDelayMs);
      }
      // react-hook-form validates on blur for some fields; give it that.
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    },

    async click(anchor, scope) {
      const el = await focusInto(anchor, scope);
      if (clickDelayMs > 0) await sleep(clickDelayMs);
      // A disabled button silently swallows .click(), which would strand
      // autopilot on a step that looks like it should have worked.
      if ("disabled" in el && (el as HTMLButtonElement).disabled) {
        await waitUntil(() => !(el as HTMLButtonElement).disabled, {
          timeoutMs: findTimeoutMs,
        });
      }
      el.click();
    },

    async check(anchor, scope) {
      const el = await focusInto(anchor, scope);
      if (!(el instanceof HTMLInputElement)) {
        throw new Error(`Anchor "${anchor}" is not a checkbox`);
      }
      if (clickDelayMs > 0) await sleep(clickDelayMs);
      // Must be a real click: setting `.checked` bypasses React's onChange
      // exactly the way setting `.value` bypasses it for text fields.
      if (!el.checked) el.click();
    },
  };
}
