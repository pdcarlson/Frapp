/**
 * Which notifications a dashboard page shows the subject of.
 *
 * A notification row names where it points in `data.target.screen`
 * (`spec/behavior/notifications.md` § Deep Linking). Opening the page that
 * screen maps to reads those rows (§ How an in-app row is marked read), so
 * this is the inverse of the drawer's `deepLinkFor`: page → screens. Chat is
 * absent on purpose: a chat row is read by reading its channel, which the API
 * does on `POST /v1/channels/{id}/read`. Billing is absent too: since #3827
 * it is a tab of Chapter settings (and a member's invoices a section of
 * `/preferences`), and a pathname can't tell Plan and billing from Roles, so
 * mapping `/settings` would mark a lapse alert read on a visit to Roles. A
 * billing row is read when it is opened.
 */
const SCREENS_BY_ROUTE: readonly (readonly [string, readonly string[]])[] = [
  // Events suggested from this time last year are reviewed here (#3930).
  ["/events", ["events", "ai_suggestions"]],
  // The board's Suggested list is where suggested tasks are reviewed (#4313).
  ["/tasks", ["tasks", "ai_suggestions"]],
  // And under the minutes they came from, where the push for them opens.
  ["/meetings", ["ai_suggestions"]],
  ["/points", ["points"]],
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
