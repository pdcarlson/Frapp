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

/**
 * Opens an in-app link whose destination isn't known until run time (a
 * notification's target): a pushed screen goes on the stack, so the swipe
 * back returns where the member was, and a tab is navigated to, which pops
 * the stack back to the tabs and switches to it. Pushing a tab would stack a
 * second copy of the tab navigator, tab bar and all, over the screen
 * (`spec/ui/mobile/navigation.md` § Going back).
 */
export function openHref(
  router: { push: (href: Href) => void; navigate: (href: Href) => void },
  href: Href,
): void {
  if (isTabHref(href)) router.navigate(href);
  else router.push(href);
}
