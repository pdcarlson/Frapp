import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept live. `false` on the server and
 * through hydration, so a caller must never let it decide first-paint layout:
 * draw that with CSS breakpoints and use this only for what a control does.
 * Shared by the shell's desktop column (`nav-face.tsx`) and Chat's member
 * list (`lib/chat/members-panel.ts`).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && !!window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}
