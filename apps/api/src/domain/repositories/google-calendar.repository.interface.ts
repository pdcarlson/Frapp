import type {
  GoogleCalendarConnection,
  GoogleCalendarOAuthState,
} from '../entities/google-calendar-connection.entity';

export const GOOGLE_CALENDAR_REPOSITORY = 'GOOGLE_CALENDAR_REPOSITORY';

/** What a sync, or a failed one, writes back to its connection. */
export interface GoogleCalendarSyncResult {
  calendar_id?: string | null;
  status?: 'active' | 'needs_reconnect';
  last_synced_at?: string;
  last_error?: string | null;
  /** Set to bring the next sync forward (more to write) or push it back. */
  sync_due_at?: string;
}

export interface IGoogleCalendarRepository {
  createState(data: {
    chapter_id: string;
    user_id: string;
    return_to: string;
    code_verifier: string;
    expires_at: string;
  }): Promise<GoogleCalendarOAuthState>;
  /**
   * A sign-in by id, spent or not, in whichever chapter. Deliberately
   * unscoped: Google's redirect carries no sign-in, and the callback only
   * reads where to send the browser. Finishing goes through `consumeState`.
   */
  findState(id: string): Promise<GoogleCalendarOAuthState | null>;
  /**
   * Spend a sign-in, only for the member and chapter that started it and only
   * before it expires. Null when nothing matched: unknown, someone else's,
   * spent, or expired, which the caller does not tell apart.
   */
  consumeState(
    id: string,
    chapterId: string,
    userId: string,
    now: Date,
  ): Promise<GoogleCalendarOAuthState | null>;
  /** Drop sign-ins that expired before `before`. Returns how many. */
  deleteExpiredStates(before: Date): Promise<number>;

  /** The member's live (not disconnecting) connection in the chapter. */
  findLive(
    chapterId: string,
    userId: string,
  ): Promise<GoogleCalendarConnection | null>;
  create(data: {
    chapter_id: string;
    user_id: string;
    google_email: string | null;
    refresh_token_sealed: string;
  }): Promise<GoogleCalendarConnection>;
  /** A fresh sign-in on the same Google account: new token, due now. */
  replaceToken(
    id: string,
    data: { google_email: string | null; refresh_token_sealed: string },
  ): Promise<void>;
  /**
   * Keep the calendar Frapp made, as soon as it is made, so a sync that fails
   * after it never makes a second one.
   */
  setCalendarId(id: string, calendarId: string): Promise<void>;
  /**
   * Leave the row for the worker to clean up at Google; `sync_due_at` becomes
   * the time the disconnect was asked for. A sync in flight keeps its lease,
   * so the cleanup waits for it. Returns the row as it now stands, or null
   * when it is gone.
   */
  markDisconnecting(id: string): Promise<GoogleCalendarConnection | null>;
  /**
   * How many other connections, in any chapter and state, use this Google
   * account. Google revokes a whole account's access at once, so a cleanup
   * leaves the grant alone while another connection still needs it.
   */
  countForAccount(
    googleEmail: string,
    exceptId: string | null,
  ): Promise<number>;
  /** Connections to sync or clean up next, each leased to this caller. */
  claim(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<GoogleCalendarConnection[]>;
  /**
   * Write what a sync came to and release its lease. A row the member
   * disconnected mid-sync stays disconnecting: only its lease is released, so
   * the cleanup runs at the next tick.
   */
  finishSync(id: string, result: GoogleCalendarSyncResult): Promise<void>;
  /** Push a cleanup's next try back, keeping the row. */
  deferCleanup(id: string, until: Date, error: string): Promise<void>;
  delete(id: string): Promise<void>;
}
