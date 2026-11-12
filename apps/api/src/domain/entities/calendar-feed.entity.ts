/**
 * A member's private calendar subscription link (#3322).
 *
 * `token` is the secret in the link's URL, and the URL is the whole
 * credential: calendar apps fetch it with no sign-in. A revoked link still
 * answers, with an empty calendar, so a calendar subscribed to it clears
 * rather than keeping the last events it saw
 * (`spec/behavior/events.md` § Calendar subscription).
 */
export interface CalendarFeed {
  id: string;
  user_id: string;
  chapter_id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
}
