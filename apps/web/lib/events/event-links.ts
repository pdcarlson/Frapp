/**
 * The web events deep-link contract: `/events?event=<id>` opens that event's
 * detail sheet on the Events page, where an officer can edit it. The Events
 * page reads the parameter; the Activity panel builds the link (#3897).
 */
export const EVENT_PARAM = "event";

export function eventDeepLink(eventId: string): string {
  return `/events?${new URLSearchParams({ [EVENT_PARAM]: eventId }).toString()}`;
}
