/**
 * A member's Google Calendar connection in one chapter (#3322, step 2;
 * `spec/behavior/events.md` § Google Calendar).
 *
 * `refresh_token_sealed` is Google's refresh token sealed by the API
 * (`google-calendar-token.ts`), never the token itself. `calendar_id` is the
 * calendar Frapp made in the member's Google account, null until the first
 * sync makes it.
 */
export type GoogleCalendarConnectionStatus =
  'active' | 'needs_reconnect' | 'disconnecting';

export interface GoogleCalendarConnection {
  id: string;
  chapter_id: string;
  user_id: string;
  google_email: string | null;
  refresh_token_sealed: string;
  calendar_id: string | null;
  status: GoogleCalendarConnectionStatus;
  sync_due_at: string;
  sync_lease_until: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

/**
 * A Google sign-in a member started, single use. `return_to` is where the
 * browser goes back to, checked when the row was made. `code_verifier` is the
 * sign-in's PKCE secret, sent to Google only when the code is traded.
 */
export interface GoogleCalendarOAuthState {
  id: string;
  chapter_id: string;
  user_id: string;
  return_to: string;
  code_verifier: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}
