import type {
  EventAgendaSuggestion,
  EventAgendaSuggestionRun,
  EventAgendaSuggestionStatus,
} from '../entities/event-agenda-suggestion.entity';

export const EVENT_AGENDA_SUGGESTION_REPOSITORY =
  'EVENT_AGENDA_SUGGESTION_REPOSITORY';

/** What a new suggestion is made of. It is created open. */
export type EventAgendaSuggestionDraft = Pick<
  EventAgendaSuggestion,
  | 'chapter_id'
  | 'event_id'
  | 'kind'
  | 'text'
  | 'reason'
  | 'source_meeting_id'
  | 'tabled_meeting_id'
  | 'tabled_start_time'
  | 'tabled_times'
  | 'dedupe_key'
  | 'audience_key'
>;

/**
 * `event_agenda_suggestions` and `event_agenda_suggestion_runs` (#5534).
 * Every read and write names the chapter: the tables have no policies, so
 * nothing else scopes them.
 */
export interface IEventAgendaSuggestionRepository {
  /** Every suggestion for the event, any status, oldest first. */
  listForEvent(
    chapterId: string,
    eventId: string,
  ): Promise<EventAgendaSuggestion[]>;
  /**
   * Writes the drafts, skipping any whose `dedupe_key` the event already
   * has (the same matter or words, whatever became of them).
   */
  insertMany(drafts: readonly EventAgendaSuggestionDraft[]): Promise<void>;
  /** Deletes the event's open suggestions with these ids. */
  deleteOpen(
    chapterId: string,
    eventId: string,
    ids: readonly string[],
  ): Promise<void>;
  /**
   * Decides an open suggestion. False when it was not open (decided
   * meanwhile, or not this event's).
   */
  decide(
    chapterId: string,
    eventId: string,
    id: string,
    change: {
      status: Exclude<EventAgendaSuggestionStatus, 'open'>;
      agenda_item_id: string | null;
      decided_by: string;
      decided_at: string;
    },
  ): Promise<boolean>;
  /** Which of these keys a suggestion in the chapter was added under. */
  addedKeys(chapterId: string, keys: readonly string[]): Promise<Set<string>>;
  /** The chapter's most recently decided suggestions, newest first. */
  listDecided(
    chapterId: string,
    limit: number,
  ): Promise<EventAgendaSuggestion[]>;
  /** When the model last wrote suggestions for the event. */
  findRun(
    chapterId: string,
    eventId: string,
  ): Promise<EventAgendaSuggestionRun | null>;
  /** Records that the model wrote suggestions for the event just now. */
  saveRun(run: EventAgendaSuggestionRun): Promise<void>;
}
