import type {
  MeetingNextAgendaItem,
  MeetingNextAgendaItemMove,
  NewMeetingNextAgendaItem,
} from '../entities/meeting-next-agenda-item.entity';

export const MEETING_NEXT_AGENDA_ITEM_REPOSITORY =
  'MEETING_NEXT_AGENDA_ITEM_REPOSITORY';

/**
 * `meeting_next_agenda_items` (#5790): action items of posted minutes sent
 * to the next meeting's agenda. Chapter-first on every read and write a
 * member reaches; `deleteExpired` alone crosses chapters, for the sweep.
 */
export interface IMeetingNextAgendaItemRepository {
  /**
   * Writes one. Idempotent on `ai_suggestion_id`: a suggestion sent twice is
   * one item, and the row already there is returned.
   */
  insert(row: NewMeetingNextAgendaItem): Promise<MeetingNextAgendaItem>;

  /** Takes one back (Undo, or a send whose suggestion couldn't be closed). */
  delete(chapterId: string, id: string): Promise<void>;

  /** The one a suggestion was sent as, if any. */
  findBySuggestion(
    chapterId: string,
    suggestionId: string,
  ): Promise<MeetingNextAgendaItem | null>;

  /** The `offered` items sent from these minutes, oldest first. */
  listOffered(
    chapterId: string,
    meetingIds: readonly string[],
  ): Promise<MeetingNextAgendaItem[]>;

  /** The chapter's `waiting` items not yet expired at `now`, oldest first. */
  listWaiting(chapterId: string, now: string): Promise<MeetingNextAgendaItem[]>;

  /**
   * Moves a `waiting` item on. False when it wasn't waiting any more
   * (another meeting's creation took it first).
   */
  moveWaiting(
    chapterId: string,
    id: string,
    move: MeetingNextAgendaItemMove,
  ): Promise<boolean>;

  /** Deletes every `waiting` item, in every chapter, expired by `now`. */
  deleteExpired(now: string): Promise<number>;

  /** The chapters, any of them, with a `waiting` item not expired at `now`. */
  listWaitingChapters(now: string): Promise<string[]>;

  /**
   * Empties the kept suggestion words of every item, in every chapter, sent
   * before `before`: Undo is over for them. Returns how many.
   */
  forgetWords(before: string): Promise<number>;
}
