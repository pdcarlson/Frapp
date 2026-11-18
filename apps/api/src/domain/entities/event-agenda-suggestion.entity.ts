import type { AgendaSuggestionKind } from '@repo/validation';

export type EventAgendaSuggestionStatus = 'open' | 'added' | 'dismissed';

/**
 * One suggestion under an event's agenda (`event_agenda_suggestions`,
 * #5534). A decided row keeps its words: the chapter's recent added and
 * dismissed items are the examples the next prompt reads.
 */
export interface EventAgendaSuggestion {
  id: string;
  chapter_id: string;
  event_id: string;
  kind: AgendaSuggestionKind;
  text: string;
  /** Why the model suggested it; null on a tabled matter. */
  reason: string | null;
  /** The posted minutes it was drawn from. */
  source_meeting_id: string | null;
  /** A tabled matter's first minutes, their start and the count; else null. */
  tabled_meeting_id: string | null;
  tabled_start_time: string | null;
  tabled_times: number | null;
  /** The same matter or words, once per event (`agenda-suggestions.ts`). */
  dedupe_key: string;
  status: EventAgendaSuggestionStatus;
  /** The agenda item an added suggestion became. */
  agenda_item_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/**
 * When the model last wrote suggestions for an event
 * (`event_agenda_suggestion_runs`).
 */
export interface EventAgendaSuggestionRun {
  event_id: string;
  chapter_id: string;
  generated_by: string | null;
  generated_at: string;
}
