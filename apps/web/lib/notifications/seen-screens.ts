/**
 * Which notifications a dashboard page shows the subject of.
 *
 * A notification row names where it points in `data.target.screen`
 * (`spec/behavior/notifications.md` § Deep Linking). Opening the page that
 * screen maps to reads those rows (§ How an in-app row is marked read), so
 * this is the inverse of the drawer's `deepLinkFor`: page → screens. Chat is
 * absent on purpose: a chat row is read by reading its channel, which the API
 * does on `POST /v1/channels/{id}/read`.
 */
const SCREENS_BY_ROUTE: readonly (readonly [string, readonly string[]])[] = [
  ["/events", ["events"]],
  ["/tasks", ["tasks"]],
  ["/points", ["points"]],
  ["/billing", ["billing"]],
  ["/service", ["service"]],
  ["/members", ["members"]],
  ["/chat-admin", ["chat_reports"]],
  ["/discord-import", ["discord_import"]],
];

const NONE: readonly string[] = [];

/** The `data.target.screen` values whose subject `pathname` shows. */
export function notificationScreensForPath(
  pathname: string | null,
): readonly string[] {
  if (!pathname) return NONE;
  for (const [route, screens] of SCREENS_BY_ROUTE) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return screens;
  }
  return NONE;
}
