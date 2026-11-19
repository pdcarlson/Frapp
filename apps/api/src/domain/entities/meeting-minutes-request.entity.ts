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
  /** When a reminder first counted this ask; null while the guard holds it. */
  announced_at: string | null;
}
