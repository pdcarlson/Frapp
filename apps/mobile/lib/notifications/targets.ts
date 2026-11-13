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
 * `points`, `service`, `members`, `ai_suggestions`, `chat_reports`,
 * `discord_import`.
 * `lib/more/notifications.ts` maps a
 * deliberately *wider* set to display labels, because a label that is merely
 * absent costs a member nothing. A route does: navigating somewhere on a guess
 * is worse than landing on the notification list, so anything unrecognized
 * falls through to `/notifications`, which can always render the row.
 *
 * Two emitted screens are deliberately absent: `chat_reports`, the officer
 * report queue (`ChatReportService`'s new-report notification), and
 * `discord_import`, the notice that a Discord import ended. Both are web
 * surfaces (`/chat-admin`, `/discord-import`) with no mobile route, so they
 * take the fallback above rather than a guess.
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
import type { Href } from "expo-router";
import { asRoute, openHref } from "../href";
import { isRecord, str } from "../more/narrow";

export interface NotificationTarget {
  pathname: string;
  params?: Record<string, string>;
  /**
   * A screen that must sit under this one on the stack, opened first. Only a
   * message thread (#3785) has one: its channel. The thread screen only
   * listens on the channel's realtime topic and never attaches it
   * (`components/chat/message-thread-screen.tsx`, `realtime-resilience`
   * rules 1 and 2), so a thread opened with nothing under it would get no live
   * replies or typing, and its back would skip the channel (#4054).
   */
  under?: NotificationTarget;
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
  // Tasks suggested from posted minutes (#4313): the officer's list.
  ai_suggestions: { pathname: "/suggested-tasks" },
};

/**
 * Where a "minutes posted" push opens (#4312). It is an `events` target that
 * also names the minutes (`meetingId`), and the member tapped it to read
 * them, not to see the event.
 */
const MINUTES: NotificationTarget = { pathname: "/minutes-details" };

/**
 * Where a task push opens. "Submitted a task" (`view: "review"`) opens the
 * review: Activity, with that task's sheet up (`/activity?review=`), since
 * the board under Tasks lists only the viewer's own tasks and an officer's
 * review was never on it. Every other task push is about the reader's own
 * task (assigned, confirmed, sent back, overdue) and opens it on their board
 * (`/tasks?task=`, the Events calendar's way in).
 */
function taskTarget(taskId: string, view: string | null): NotificationTarget {
  return view === "review"
    ? { pathname: "/activity", params: { review: taskId } }
    : { pathname: "/tasks", params: { task: taskId } };
}

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

/**
 * The channel a chat push is about, or `null` for any other push. Reads the
 * same `target` a tap resolves (`{ screen: "chat", channelId }`).
 */
export function chatChannelIdFrom(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.target)) return null;
  if (str(data.target, "screen") !== "chat") return null;
  return str(data.target, "channelId");
}

/**
 * Whether a chat push is about a reply inside a message thread (#3785). Its
 * target names the channel too, but the channel's read state says nothing
 * about the thread: thread replies never count toward the channel's unread.
 */
export function isThreadChatPush(data: unknown): boolean {
  return (
    isRecord(data) &&
    isRecord(data.target) &&
    str(data.target, "threadRootId") !== null
  );
}

/**
 * The focused screen's path as `openHref` may replace it, or `undefined` when
 * a tap must push instead. A message thread (#3785) is `/chat-thread` again
 * with a `threadRootId`, so by path alone a chat push tapped inside a thread
 * would replace the thread with the pushed channel, leaving the thread's own
 * channel stacked under a channel (`spec/ui/mobile/navigation.md` § Going
 * back). Over a thread the push goes on the stack, so back returns to the
 * thread, then its channel.
 */
export function replaceablePathname(
  pathname: string,
  threadRootId: string | string[] | undefined,
): string | undefined {
  const rootId = Array.isArray(threadRootId) ? threadRootId[0] : threadRootId;
  return rootId ? undefined : pathname;
}

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
  const meetingId = screen === "events" ? str(target, "meetingId") : null;
  if (meetingId) return { ...MINUTES, params: { id: meetingId } };
  const taskId = screen === "tasks" ? str(target, "taskId") : null;
  if (taskId) return taskTarget(taskId, str(target, "view"));
  const route = screen ? ROUTES[screen] : undefined;
  if (!route) return FALLBACK;

  if (!route.param) return { pathname: route.pathname };

  const value = str(target, route.param);
  if (!value) return FALLBACK;

  const resolved: NotificationTarget = {
    pathname: route.pathname,
    params: { [route.as ?? route.param]: value },
  };

  // A thread reply's push names its root too (`spec/behavior/chat/README.md`
  // § Message threads → Notifications). The thread is the channel's route
  // pushed again with the root, over the channel (#4054).
  const threadRootId = screen === "chat" ? str(target, "threadRootId") : null;
  if (!threadRootId) return resolved;
  return {
    pathname: route.pathname,
    params: { channelId: value, threadRootId },
    under: resolved,
  };
}

/** The slice of expo-router's router `openNotificationTarget` calls. */
type NotificationRouter = Parameters<typeof openHref>[0];

/**
 * Opens a resolved target, the screen it needs under it first.
 *
 * The screen under goes through `openHref`, so a thread push tapped while a
 * channel is open replaces that channel as a channel push would, and the
 * thread is then pushed over it. The thread itself is always pushed: its path
 * is a channel's, so `openHref` would otherwise replace the channel it was just
 * stacked on. Both calls run in one tick: expo-router queues them
 * (`routingQueue`) and dispatches each against the root state the one before
 * it left.
 */
export function openNotificationTarget(
  router: NotificationRouter,
  target: NotificationTarget,
  currentPathname?: string,
): void {
  const href: Href = asRoute(notificationHref(target));
  if (!target.under) {
    openHref(router, href, currentPathname);
    return;
  }
  openHref(router, asRoute(notificationHref(target.under)), currentPathname);
  router.push(href);
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
