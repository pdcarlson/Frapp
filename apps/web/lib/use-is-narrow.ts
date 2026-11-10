import { useCallback, useState } from "react";

/**
 * Whether an element is narrower than `below` pixels, kept live with a
 * `ResizeObserver`: `null` until it is first measured (server render, and
 * jsdom, whose observer stub never fires and whose boxes measure 0).
 *
 * For a shape a CSS container query can't draw, where the narrow layout is a
 * different tree rather than restyled boxes (the Events calendar's compact
 * month, #4022). Beside chat (#3779) a tool page is narrow while the window
 * is wide, so a viewport media query gives the wrong answer there. Restyling
 * alone belongs in CSS: an `@container` and `@` variants.
 *
 * - **Measured in the ref, before paint.** React runs a callback ref in the
 *   commit, so the first answer lands before the browser paints and a narrow
 *   page never flashes the wide tree.
 * - **Hysteresis.** Once narrow, it stays narrow until the width reaches
 *   `below + slack`. The two trees differ in height, so swapping them can add
 *   or remove the scroll pane's scrollbar, which moves the width by ~15px;
 *   without the slack a width just over `below` would flip every frame.
 * - **A boolean, not the width.** State changes only at a crossing, so
 *   dragging the chat divider doesn't re-render the consumer every frame.
 *
 * Returns a callback ref for the element (React 19 runs its returned cleanup
 * on detach), and the answer.
 */
export function useIsNarrow<T extends HTMLElement>(
  below: number,
  slack = 40,
): [(node: T | null) => (() => void) | undefined, boolean | null] {
  const [narrow, setNarrow] = useState<boolean | null>(null);

  const ref = useCallback(
    (node: T | null) => {
      if (!node || typeof ResizeObserver === "undefined") return undefined;
      let current: boolean | null = null;
      const update = (width: number) => {
        // A detached or hidden box measures 0: no answer, not "narrow".
        if (width <= 0) return;
        const next = current === true ? width < below + slack : width < below;
        if (next !== current) {
          current = next;
          setNarrow(next);
        }
      };
      update(node.getBoundingClientRect().width);
      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) update(entry.contentRect.width);
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
    [below, slack],
  );

  return [ref, narrow];
}
