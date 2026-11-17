import type { Href } from "expo-router";

/**
 * Typed-route generation does not always include every file-based path in this app.
 * Use for static in-app paths that are valid at runtime.
 */
export function asRoute(path: string): Href {
  return path as Href;
}

/** The four tabs' paths (`app/(app)/(tabs)/`). */
const TAB_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/activity",
  "/messages",
  "/you",
]);

/** Whether `href` opens one of the four tabs rather than a pushed screen. */
export function isTabHref(href: Href): boolean {
  return TAB_PATHS.has(pathOf(href));
}

/** The slice of expo-router's router these helpers call. */
type TabRouter = {
  push: (href: Href) => void;
  replace: (href: Href) => void;
  dismissTo: (href: Href) => void;
};

/**
 * Opens an in-app link whose destination isn't known until run time (a
 * notification's target): a pushed screen goes on the stack, so the swipe
 * back returns where the member was, and a tab is reached by popping the stack
 * back down to the tabs (`dismissTo`) and switching to it. Pushing a tab, or
 * navigating to one, from a pushed screen would stack a second copy of the
 * tab navigator, tab bar and all, over the screen: expo-router's stack only
 * reuses a route that is already on top (`spec/ui/mobile/navigation.md`
 * § Going back). A link to the kind of screen already on top replaces it
 * (`currentPathname`, the focused route's path): a push for #academics while
 * a channel is open stacked a second channel, so the swipe back landed in a
 * channel again before the list (owner, 2026-11-07). Replacing keeps what was
 * under it, so back still reaches chat home.
 */
export function openHref(
  router: TabRouter,
  href: Href,
  currentPathname?: string,
): void {
  if (isTabHref(href)) router.dismissTo(href);
  else if (currentPathname !== undefined && pathOf(href) === currentPathname)
    router.replace(href);
  else router.push(href);
}

function pathOf(href: Href): string {
  return typeof href === "string"
    ? href.split(/[?#]/)[0]!
    : String(href.pathname);
}

/**
 * A drawn way back's fixed destination, for when the screen under this one
 * isn't where back should land (or nothing is under it). It pops the stack
 * down to `href` (`dismissTo`): to the tabs and that tab for a tab, for the
 * reason `openHref` gives, and to the screen itself when it is already in the
 * stack. When it isn't, the current screen is replaced by it, so back never
 * stacks a second copy of the destination over the screen being left: a
 * plain navigate pushed a second Calendar over a just-deleted event once
 * Calendar became a pushed screen (#5310).
 */
export function goBackTo(router: TabRouter, href: Href): void {
  router.dismissTo(href);
}
