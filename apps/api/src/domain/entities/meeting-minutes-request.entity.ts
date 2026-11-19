/**
 * A member who asked for one meeting's unposted minutes (#5471,
 * `spec/behavior/meetings.md` § Asking for minutes). Gone once the minutes
 * are posted. See `20261119162302_meeting_minutes_requests.sql`.
 */
export interface MeetingMinutesRequest {
  meeting_id: string;
  chapter_id: string;
  user_id: string;
  created_at: string;
  /** Set on the request that sent the ping; null on one the guard held. */
  pinged_at: string | null;
  /** Whether a ping has named this request yet. */
  announced: boolean;
}
