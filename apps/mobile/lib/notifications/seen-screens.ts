/**
 * Which notifications a screen shows the subject of.
 *
 * Opening the screen a notification points at reads it
 * (`spec/behavior/notifications.md` § How an in-app row is marked read). This
 * is the inverse of `targets.ts`' `ROUTES` (screen → route): route → the
 * `data.target.screen` values that land there. Chat is absent on purpose: a
 * chat row is read by reading its channel, which the API does on
 * `POST /v1/channels/{id}/read`. `chat_reports` and `discord_import` have no
 * screen here (their pages are web-only), so those rows are read by tapping
 * them, or by opening the page on web.
 */
const SCREENS_BY_PATHNAME: Record<string, readonly string[]> = {
  "/events": ["events"],
  "/event-details": ["events"],
  // Points were absorbed into the task board, as in `targets.ts`.
  "/tasks": ["tasks", "points"],
  "/dues": ["billing"],
  "/service-hours": ["service"],
  "/directory": ["members"],
};

const NONE: readonly string[] = [];

/** The `data.target.screen` values whose subject `pathname` shows. */
export function notificationScreensForPathname(
  pathname: string | null | undefined,
): readonly string[] {
  if (!pathname) return NONE;
  return SCREENS_BY_PATHNAME[pathname] ?? NONE;
}
