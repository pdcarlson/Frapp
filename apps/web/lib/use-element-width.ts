import { useCallback, useState } from "react";

/**
 * An element's own rendered width, kept live with a `ResizeObserver`: `null`
 * until it is first measured (server render, hydration, and jsdom, whose
 * observer stub never fires).
 *
 * For a shape a CSS container query can't draw, where the narrow layout is a
 * different tree rather than restyled boxes (the Events calendar's compact
 * month, #4022). Beside chat (#3779) a tool page is narrow while the window
 * is wide, so a viewport media query gives the wrong answer there. Restyling
 * alone belongs in CSS: an `@container` on the page root and `@` variants.
 *
 * Returns a callback ref for the element (React 19 runs its returned cleanup
 * on detach), and the width.
 */
export function useElementWidth<T extends HTMLElement>(): [
  (node: T | null) => (() => void) | undefined,
  number | null,
] {
  const [width, setWidth] = useState<number | null>(null);

  const ref = useCallback((node: T | null) => {
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
