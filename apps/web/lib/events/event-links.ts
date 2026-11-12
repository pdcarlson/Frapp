/**
 * The web events deep-link contract: `/events?event=<id>` opens that event's
 * detail sheet on the Events page, where an officer can edit it. The Events
 * page reads the parameter; the Activity panel builds the link (#3897), and
 * so does the API, in each calendar subscription item it serves
 * (`apps/api/src/application/services/calendar-feed/calendar-feed.service.ts`,
 * #3322), so a change here changes that link too.
 */
export const EVENT_PARAM = "event";

export function eventDeepLink(eventId: string): string {
  return `/events?${new URLSearchParams({ [EVENT_PARAM]: eventId }).toString()}`;
}
