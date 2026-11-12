/**
 * The Google side of Google Calendar connections (#3322, step 2): Google's
 * OAuth endpoints and the Calendar API, only the calls Frapp makes.
 *
 * Frapp asks for `calendar.app.created` (make calendars, and manage the
 * events on the calendars it made, nothing else in the account) plus
 * `openid email`, so the menu can say which Google account is connected.
 */
export const GOOGLE_CALENDAR_API = 'GOOGLE_CALENDAR_API';

export const GOOGLE_CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.app.created';

/** What a finished sign-in hands back. */
export interface GoogleCalendarGrant {
  refreshToken: string;
  /** From the ID token Google returns with `openid email`; null if absent. */
  email: string | null;
  /** The scopes the member actually granted (Google lets them untick one). */
  scopes: string[];
}

/** One Frapp item as a Google Calendar event. */
export interface GoogleCalendarEventInput {
  /** Frapp's own id for the event (base32hex), stable across syncs. */
  id: string;
  summary: string;
  description: string;
  location: string | null;
  start: { dateTime: string } | { date: string };
  end: { dateTime: string } | { date: string };
  /** The item's page in Frapp, shown by Google as the event's source. */
  sourceUrl: string;
  /** Free time on the member's calendar (a task's due time), not busy. */
  transparent: boolean;
  /** What this write carries, kept on the event to skip unchanged ones. */
  hash: string;
}

/** An event on Frapp's calendar, as a sync reads it back. */
export interface GoogleCalendarEventRef {
  id: string;
  /** Null for an event Frapp did not write (one the member added by hand). */
  hash: string | null;
  /** When it ends (a date-time, or a date for an all-day event), if known. */
  endsAt: string | null;
}

export type GoogleCalendarErrorKind =
  /** Google refused the refresh token: revoked, expired or password changed. */
  | 'invalid_grant'
  /** The calendar or event is gone (404 or 410). */
  | 'not_found'
  /** An event with that id already exists, perhaps deleted (409). */
  | 'conflict'
  /** A quota or rate limit (403 rate limits, 429). */
  | 'rate_limited'
  /** Anything else: a 5xx, a timeout, a network failure, a 400. */
  | 'failed';

export class GoogleCalendarApiError extends Error {
  constructor(
    readonly kind: GoogleCalendarErrorKind,
    readonly status: number | null,
    /** Google's own short reason, never a token or a body. */
    readonly reason: string,
  ) {
    super(`Google Calendar: ${kind}${status ? ` (${status})` : ''}: ${reason}`);
    this.name = 'GoogleCalendarApiError';
  }
}

export interface IGoogleCalendarApi {
  /** Whether a client id and secret are configured. */
  isConfigured(): boolean;
  /** Google's consent page for one sign-in. */
  authorizeUrl(params: { state: string; redirectUri: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleCalendarGrant>;
  /** A short-lived access token for a refresh token. */
  accessToken(refreshToken: string): Promise<string>;
  /** Revoke a refresh token at Google. A token Google no longer knows is fine. */
  revoke(refreshToken: string): Promise<void>;
  createCalendar(
    accessToken: string,
    calendar: { summary: string; description: string },
  ): Promise<string>;
  deleteCalendar(accessToken: string, calendarId: string): Promise<void>;
  listEvents(
    accessToken: string,
    calendarId: string,
  ): Promise<GoogleCalendarEventRef[]>;
  insertEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleCalendarEventInput,
  ): Promise<void>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleCalendarEventInput,
  ): Promise<void>;
  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void>;
}
