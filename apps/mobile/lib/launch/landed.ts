/**
 * The screen in front, read from the navigation container's state, or null
 * while no screen has mounted yet (#5449).
 *
 * The container's root state holds a navigator's state only once that
 * navigator has mounted. While a group's layout renders nothing (the auth
 * gate's hold in `app/(app)/_layout.tsx`), the focused route ends at the group
 * itself, `(app)`, with no state of its own: nothing is on screen yet. Once its
 * navigator mounts, the focused route ends at a screen (`index`, `sign-in`,
 * `event-details`). Groups are the parenthesised names and `__root` is
 * expo-router's own wrapper; neither is a screen.
 *
 * Read from the container rather than `useRootNavigationState`, which stops
 * updating once the root navigator has mounted and never sees a nested
 * navigator arrive (checked against the Expo web build, 2026-11-18).
 */
type NavState = {
  index?: number;
  routes: readonly NavRoute[];
};

type NavRoute = {
  name: string;
  state?: NavState;
};

export function landedScreen(
  state: NavState | undefined | null,
): string | null {
  let current = state;
  while (current && current.routes.length > 0) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) return null;
    if (route.state) {
      current = route.state;
      continue;
    }
    return isScreenName(route.name) ? route.name : null;
  }
  return null;
}

function isScreenName(name: string): boolean {
  return name !== "__root" && !(name.startsWith("(") && name.endsWith(")"));
}
