/**
 * An action item of posted minutes an officer sent to the next meeting's
 * agenda instead of making it a task (`meeting_next_agenda_items`, #5790).
 * It names no meeting: every later upcoming meeting with the same audience
 * as the minutes' offers it under Suggested until one adds it (Paul's
 * "offer, don't pick", `spec/behavior/meetings.md` "Where it goes next").
 */
export interface MeetingNextAgendaItem {
  id: string;
  chapter_id: string;
  /** The posted minutes it came from. Deleting them deletes it. */
  meeting_id: string;
  /** The words, as an agenda item holds them (at most 200 characters). */
  text: string;
  /** The suggested task it was sent from, while that row exists. */
  ai_suggestion_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** A row to write, before the database fills its id and time. */
export type NewMeetingNextAgendaItem = Pick<
  MeetingNextAgendaItem,
  'chapter_id' | 'meeting_id' | 'text' | 'ai_suggestion_id' | 'created_by'
>;
