import { useCallback, useSyncExternalStore } from "react";

/**
 * A CSS media query, kept live, that says when it does not know yet: `null`
 * on the server and through hydration, then the real answer. The dashboard
 * shell needs the difference (`components/layout/shell-layout.ts`): treating
 * "not known" as "no match" would unmount chat beside a tool page on every
 * desktop load and build it again a frame later.
 *
 * `subscribe` is memoized on the query: a fresh function each render would
 * make `useSyncExternalStore` drop and re-add the listener on every render of
 * the chat shell, which re-renders on every message.
 */
export function useMediaQueryState(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () =>
      typeof window !== "undefined" && !!window.matchMedia
        ? window.matchMedia(query).matches
        : null,
    () => null,
  );
}

const noSubscribe = () => () => {};

/**
 * `false` on the server and through hydration, `true` from the first render
 * after it (and on any render that is not a hydration). For drawing both
 * answers to a width question until the client knows its width, and letting
 * CSS pick between them (`dashboard-shell.tsx`, the forced nav rail, #4024).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Whether a CSS media query matches. `false` on the server and through
 * hydration, so a caller must never let it decide first-paint layout: draw
 * that with CSS breakpoints and use this only for what a control does (Chat's
 * member list, `components/chat/chat-shell.tsx`).
 */
export function useMediaQuery(query: string): boolean {
  return useMediaQueryState(query) ?? false;
}
