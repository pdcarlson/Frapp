/**
 * `data.target` → an in-app route, for a tapped notification.
 *
 * Every push carries a `target` naming a screen and its parameters
 * (`spec/behavior/notifications.md` § Deep Linking), and `NotificationService`
 * additionally stamps `notificationId` — the id of the in-app `notifications`
 * row it just wrote — into every payload. This module reads both. It is pure
 * and holds no React: the same resolution has to run from a cold-start read and
 * from a warm listener, and neither is a render.
 *
 * ## The screen vocabulary is the server's, not the drawer's
 *
 * The keys below are the values `apps/api` actually emits, found by grepping
 * `target: {` across its services: `chat`, `events`, `tasks`, `billing`,
 * `points`, `service`, `members`. `lib/more/notifications.ts` maps a
 * deliberately *wider* set to display labels, because a label that is merely
 * absent costs a member nothing. A route does: navigating somewhere on a guess
 * is worse than landing on the notification list, so anything unrecognized
 * falls through to `/notifications`, which can always render the row.
 *
 * ## Why the table is spelled with `pathname:`
 *
 * `lib/routes.spec.ts` is what actually checks route strings against the file
 * tree — typed routes do not bind in CI (its header explains why). It matches
 * double-quoted literals at five syntactic sites, and `pathname: "…"` is one of
 * them. Writing this table as `chat: "/chat-thread"` would compile, ship, and be
 * invisible to that guard, so a later rename would break every chat
 * notification with nothing failing. The shape is load-bearing; do not
 * "simplify" it to bare values.
 */
import { isRecord, str } from "../more/narrow";

export interface NotificationTarget {
  pathname: string;
  params?: Record<string, string>;
}

/**
 * One row per screen the API emits.
 *
 * `param` is the key to read off the payload's `target`; `as` is what the
 * destination route expects, when the two differ. s07 reads an `id` param
 * (`spec/ui/mobile/screens.md`), while the payload spells it `eventId`.
 */
const ROUTES: Record<
  string,
  NotificationTarget & { param?: string; as?: string }
> = {
  chat: { pathname: "/chat-thread", param: "channelId" },
  events: { pathname: "/event-details", param: "eventId", as: "id" },
  tasks: { pathname: "/tasks" },
  // Points were absorbed into the task board in C3 — there is no points route.
  points: { pathname: "/tasks" },
  billing: { pathname: "/dues" },
  service: { pathname: "/service-hours" },
  members: { pathname: "/directory" },
};

/**
 * Where an unrecognized or malformed target lands. Always renderable.
 *
 * Exported because callers legitimately need to ask "did this resolve, or did
 * it fall back?" — s14 does, to avoid pushing the notification list on top of
 * itself. Comparing against a bare `"/notifications"` literal at each call site
 * would be the same magic value written twice.
 */
export const NOTIFICATION_FALLBACK_PATHNAME = "/notifications";

const FALLBACK: NotificationTarget = {
  pathname: NOTIFICATION_FALLBACK_PATHNAME,
};

/** The in-app `notifications` row id, so a tap can mark it read. */
export function notificationIdFrom(data: unknown): string | null {
  return isRecord(data) ? str(data, "notificationId") : null;
}

/**
 * The route a tap should open.
 *
 * Never returns `null`: a member who taps a notification has asked to go
 * somewhere, and the notification list is a truthful answer for a payload this
 * build does not understand. A missing required param degrades the same way —
 * `/chat-thread` with no `channelId` would render an error, so it is not
 * offered.
 */
export function resolveNotificationTarget(data: unknown): NotificationTarget {
  if (!isRecord(data)) return FALLBACK;

  const target = data.target;
  if (!isRecord(target)) return FALLBACK;

  const screen = str(target, "screen");
  const route = screen ? ROUTES[screen] : undefined;
  if (!route) return FALLBACK;

  if (!route.param) return { pathname: route.pathname };

  const value = str(target, route.param);
  if (!value) return FALLBACK;

  return {
    pathname: route.pathname,
    params: { [route.as ?? route.param]: value },
  };
}

/**
 * A target as a path `asRoute()` can take.
 *
 * The object form (`router.push({ pathname, params })`) is how the rest of the
 * app navigates with a param, but it cannot be used here: its `pathname` field
 * wants a bare `string`, while `asRoute` — the sanctioned escape hatch for a
 * path the type-checker cannot see (`spec/ui/mobile/navigation.md`) — returns
 * `Href`, which is `string | HrefObject`. Passing the raw runtime string
 * instead would compile in CI, where typed routes are absent and `Href` widens
 * to `string`, and fail on a developer's machine where they are generated.
 *
 * Query params reach a screen as route params identically, so this form is
 * equivalent for the caller and typed for the compiler.
 */
export function notificationHref(target: NotificationTarget): string {
  if (!target.params) return target.pathname;
  const query = Object.entries(target.params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return `${target.pathname}?${query}`;
}
