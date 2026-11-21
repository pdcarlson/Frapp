/**
 * Where an item sent to the next meeting's agenda stands (#5790):
 * - `placed`: on the agenda of the next upcoming meeting with the minutes'
 *   audience (Shawn, 2026-11-20: "just go add straight on to the agenda").
 * - `offered`: the officer couldn't edit that meeting, so upcoming meetings
 *   with that audience offer it under Suggested, as tabled items are.
 * - `waiting`: no such meeting yet; it goes onto the next one created, and is
 *   deleted at `expires_at` if none is.
 */
export type MeetingNextAgendaItemState = 'placed' | 'offered' | 'waiting';

/**
 * An action item of posted minutes an officer sent to the next meeting's
 * agenda instead of making it a task (`meeting_next_agenda_items`, #5790).
 */
export interface MeetingNextAgendaItem {
  id: string;
  chapter_id: string;
  /** The posted minutes it came from. Deleting them deletes it. */
  meeting_id: string;
  /**
   * The minutes' own meeting, whose audience, type and series pick the next
   * one; null once it is deleted.
   */
  source_event_id: string | null;
  /** The words, as an agenda item holds them (at most 200 characters). */
  text: string;
  state: MeetingNextAgendaItemState;
  /** The meeting it was placed on, while that meeting exists. */
  event_id: string | null;
  /** The agenda item it became there. */
  agenda_item_id: string | null;
  /** When a `waiting` item is deleted; null otherwise. */
  expires_at: string | null;
  /** The suggested task it was sent from, while that row exists. */
  ai_suggestion_id: string | null;
  /**
   * That suggestion's own words, for Undo: a decided suggestion holds none,
   * so these put it back as it was.
   */
  suggestion_payload: Record<string, unknown>;
  suggestion_quote: string | null;
  created_by: string | null;
  created_at: string;
}

/** A row to write, before the database fills its time. */
export type NewMeetingNextAgendaItem = Pick<
  MeetingNextAgendaItem,
  | 'id'
  | 'chapter_id'
  | 'meeting_id'
  | 'source_event_id'
  | 'text'
  | 'state'
  | 'event_id'
  | 'agenda_item_id'
  | 'expires_at'
  | 'ai_suggestion_id'
  | 'suggestion_payload'
  | 'suggestion_quote'
  | 'created_by'
>;

/** A change of state: placed on a meeting, or offered under Suggested. */
export type MeetingNextAgendaItemMove =
  | { state: 'placed'; event_id: string; agenda_item_id: string }
  | { state: 'offered'; event_id: string | null };
