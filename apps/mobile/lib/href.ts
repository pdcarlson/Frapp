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
  "/events",
  "/tasks",
  "/more",
]);

/** Whether `href` opens one of the four tabs rather than a pushed screen. */
export function isTabHref(href: Href): boolean {
  const pathname =
    typeof href === "string" ? href.split(/[?#]/)[0]! : String(href.pathname);
  return TAB_PATHS.has(pathname);
}

/** The slice of expo-router's router these helpers call. */
type TabRouter = {
  push: (href: Href) => void;
  navigate: (href: Href) => void;
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
 * § Going back).
 */
export function openHref(router: TabRouter, href: Href): void {
  if (isTabHref(href)) router.dismissTo(href);
  else router.push(href);
}

/**
 * A drawn way back's fixed destination, for when nothing is under the screen
 * to pop to: a tab is popped down to, for the reason `openHref` gives, and any
 * other screen is navigated to.
 */
export function goBackTo(router: TabRouter, href: Href): void {
  if (isTabHref(href)) router.dismissTo(href);
  else router.navigate(href);
}
