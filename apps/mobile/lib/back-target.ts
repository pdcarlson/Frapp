import { useCallback, useContext, useEffect } from "react";
import {
  NavigationContext,
  NavigationRouteContext,
} from "expo-router/react-navigation";

/**
 * Going back through the stack (`spec/ui/mobile/navigation.md` § Going back).
 *
 * Every screen outside the four tabs is pushed onto the stack in
 * `app/(app)/_layout.tsx`, over the tabs. The platform's own back (the edge
 * swipe on iOS, the back button or back gesture on Android) pops it to
 * whatever is under it, so the drawn ways back (the `‹ Events` capsule, s05's
 * `‹`, the close controls on s18 and s22) pop it too, and name what is under
 * it. A drawn control that went somewhere else than the swipe would be two
 * answers to one question.
 */

/**
 * The name a back capsule gives each screen it can return to. The four tab
 * layouts read their tab titles from here too, so a tab is called the same
 * thing in the bar and on the capsule over it.
 */
export const SCREEN_TITLES = {
  index: "Chat",
  activity: "Activity",
  // The route stays `events` so links and notification targets keep working;
  // the tab holds tasks too, so it is named for the calendar (#4610).
  events: "Calendar",
  more: "More",
  // A pushed screen since #4610, opened from Activity, Calendar and Up next.
  tasks: "Tasks",
  // The thread names a channel, which a capsule has no room for; "Chat" is
  // where the member is going back to.
  "chat-thread": "Chat",
  "event-details": "Event",
  notifications: "Notifications",
  messages: "Messages",
  preferences: "Settings",
  profile: "Profile",
  "service-hours": "Service hours",
  study: "Study hours",
  dues: "Dues",
  documents: "Documents",
  directory: "Directory",
  invite: "Invite members",
  "check-in": "Check in",
  "host-check-in": "Host check-in",
  "whats-new": "What's new",
  minutes: "Minutes",
  // One meeting's minutes: the capsule over it says where back goes.
  "minutes-details": "Minutes",
  // Tasks and, since #3930, events: `AI_SUGGESTION_COPY.listHeading`.
  "suggested-tasks": "Suggested",
  "arrange-channels": "Arrange channels",
  "chapter-settings": "Chapter settings",
  "chapter-roles": "Roles",
  // A tier's and a role's pages are titled by their own name, which a
  // capsule has no room for, so both read as the list they belong to.
  "role-tier": "Roles",
  role: "Roles",
} as const satisfies Record<string, string>;

/** The group in `app/(app)/` that holds the tab navigator. */
const TABS_ROUTE = "(tabs)";

/** The slice of React Navigation's state this reads. */
export type StackRoute = {
  key: string;
  name: string;
  params?: object;
  state?: { index?: number; routes: readonly { name: string }[] };
};

/**
 * The screen under `key` in `routes`, by its route name, or null when `key`
 * is the bottom of the stack. The tab navigator counts as the tab it shows:
 * its focused route once it has rendered, the `screen` it was opened with, or
 * Chat home, which is the tab group's first route.
 */
export function screenBelowName(
  routes: readonly StackRoute[],
  key: string,
): string | null {
  const index = routes.findIndex((route) => route.key === key);
  if (index <= 0) return null;
  const below = routes[index - 1]!;
  if (below.name !== TABS_ROUTE) return below.name;
  const nested = below.state;
  if (nested && nested.routes.length > 0) {
    return nested.routes[nested.index ?? nested.routes.length - 1]!.name;
  }
  const screen = (below.params as { screen?: unknown } | undefined)?.screen;
  return typeof screen === "string" ? screen : "index";
}

/** What a back control returns to, and the way there. */
export type ScreenBelow = {
  /** The route under this screen, a tab's own name when it is a tab. */
  name: string;
  /** What the member calls it: `SCREEN_TITLES`, else "Back". */
  title: string;
  /** Pops this screen, as the swipe does. */
  goBack: () => void;
};

/**
 * The screen under the one this renders in, or null when nothing is under it
 * or the caller isn't on a stack screen at all (a tab's own screen, a sheet's
 * portal, a spec with no navigator). A null is the caller's cue to fall back
 * to its fixed destination.
 */
export function useScreenBelow(): ScreenBelow | null {
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const goBack = useCallback(() => navigation?.goBack(), [navigation]);
  if (!navigation || !route) return null;
  const state = navigation.getState() as
    { type?: string; routes: readonly StackRoute[] } | undefined;
  // Only a stack pops. A tab screen's navigator is the tab navigator, whose
  // "back" is a tab switch, not the screen under this one.
  if (!state || state.type !== "stack") return null;
  const name = screenBelowName(state.routes, route.key);
  if (!name) return null;
  const title =
    (SCREEN_TITLES as Record<string, string | undefined>)[name] ?? "Back";
  return { name, title, goBack };
}

/**
 * While `hold` is true, the iOS edge swipe can't pop this screen. For a screen
 * whose own content would be lost to the swipe:
 *
 * - An in-tree overlay that covers the screen and takes its own drags (s05's
 *   photo viewer, which pans a zoomed photo): a swipe that started a pan and
 *   popped the thread instead would close the conversation under the
 *   member's finger.
 * - A step inside one route that the swipe can't step back through
 *   (create-chapter's confirm and colour steps): the swipe would pop the
 *   whole flow and drop what was entered, where the drawn ‹ and Android's
 *   back step back one step.
 *
 * Android's back is the screen's own there (`useBackToClose` in
 * `lib/overlay.ts`). Held on this screen's navigator and every one it is
 * nested in, since the swipe that pops a flow pushed as a group (`(auth)`
 * over the app) belongs to the outer stack. Released when `hold` turns false
 * or the caller unmounts. A no-op outside a navigator.
 */
export function useHoldSwipeBack(hold: boolean): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation || !hold) return;
    const held: { setOptions: (options: object) => void }[] = [];
    for (
      let at: typeof navigation | undefined = navigation;
      at;
      at = at.getParent?.()
    ) {
      at.setOptions({ gestureEnabled: false });
      held.push(at);
    }
    return () => {
      for (const at of held) at.setOptions({ gestureEnabled: true });
    };
  }, [navigation, hold]);
}
