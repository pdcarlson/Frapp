/**
 * A meeting an officer marked "No minutes" (Paul, 2026-11-20: "can I say we
 * don't have minutes? should be a valid option"): it stops asking for them.
 * Gone when minutes start on the event, or the mark is undone. See
 * `spec/behavior/meetings.md` § Meetings, tied to their events.
 */
export interface MeetingNoMinutes {
  event_id: string;
  chapter_id: string;
  marked_by: string | null;
  created_at: string;
}
