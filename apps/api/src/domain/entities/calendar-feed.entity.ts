/**
 * A member's private calendar subscription link (#3322).
 *
 * The token is the secret in the link's URL, and the URL is the whole
 * credential: calendar apps fetch it with no sign-in. The database keeps it in
 * two forms neither of which reads as the link: `token_hash` (sha256, what a
 * fetch looks it up by) and `token_sealed` (under `CALENDAR_FEED_TOKEN_KEY`,
 * so the Subscribe menu can show the link again). `token` is the plaintext,
 * left only on links made before 20261119182553 until their next fetch or
 * show seals it. A revoked link still answers, with an empty calendar, so a
 * calendar subscribed to it clears rather than keeping the last events it saw
 * (`spec/behavior/events.md` § Calendar subscription).
 */
export interface CalendarFeed {
  id: string;
  user_id: string;
  chapter_id: string;
  /** Legacy plaintext; null once sealed. */
  token: string | null;
  token_hash: string;
  token_sealed: string | null;
  created_at: string;
  revoked_at: string | null;
}
