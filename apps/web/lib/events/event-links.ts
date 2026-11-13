/**
 * The web events deep-link contract: `/events?event=<id>` opens that event's
 * detail sheet on the Events page, where an officer can edit it. The Events
 * page reads the parameter; the Activity panel builds the link (#3897), and
 * so does the API, in each calendar subscription item it serves
 * (`apps/api/src/application/services/calendar-feed/calendar-feed.service.ts`,
 * #3322), so a change here changes that link too.
 */
export const EVENT_PARAM = "event";

/**
 * `&excuse=1` also opens the sheet's Can't make it line: the chat event
 * card's button (#4660). Only the Events page reads it.
 */
export const EXCUSE_PARAM = "excuse";

export function eventDeepLink(
  eventId: string,
  options: { excuse?: boolean } = {},
): string {
  const params = new URLSearchParams({ [EVENT_PARAM]: eventId });
  if (options.excuse) params.set(EXCUSE_PARAM, "1");
  return `/events?${params.toString()}`;
}
