"use client";

import { useEffect, useState } from "react";
import { queryAnchor } from "@/lib/demo/dom-drive";
import type { ResolvedScope } from "@/lib/demo/tour-types";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Dims the page and rings the element the current step is about.
 *
 * The whole overlay is pointer-events: none, so the dimming is purely
 * visual -- the audience can still click the highlighted control, and can
 * still click anything else. A spotlight that traps the pointer turns a demo
 * into a cage, and the point of the launcher is that people keep their
 * freedom to wander.
 */
export function Spotlight({
  anchor,
  scope,
}: {
  anchor: string | undefined;
  scope?: ResolvedScope;
}) {
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!anchor) {
      setBox(null);
      return;
    }

    let frame = 0;
    // Once per arrival at an anchor, never from inside `measure`: that runs on
    // every scroll, mutation and poll tick, so scrolling there would drag the
    // page back the moment a viewer scrolled away to look at something else.
    // The driver does the same for steps it performs (dom-drive.ts) -- this is
    // what covers the steps a human performs.
    let brought = false;
    const measure = () => {
      const el = queryAnchor(anchor, scope);
      if (!el) {
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Zero-sized means it is hidden rather than absent -- ring nothing
      // instead of drawing a dot in the corner.
      if (r.width === 0 && r.height === 0) {
        setBox(null);
        return;
      }
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
      if (!brought) {
        brought = true;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    // Layout can move under us for reasons no single listener covers:
    // scrolling, resizing, and React swapping the element out entirely.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const poll = setInterval(measure, 400);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      clearInterval(poll);
    };
  }, [anchor, scope]);

  if (!box) return null;

  const pad = 6;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-40 rounded-lg ring-2 ring-warning transition-all duration-200"
      style={{
        top: box.top - pad,
        left: box.left - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
        // The scrim IS this element's shadow, so it can never intercept a
        // click the way a full-screen sibling would.
        boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
      }}
    />
  );
}
