import type {
  MeetingNextAgendaItem,
  NewMeetingNextAgendaItem,
} from '../entities/meeting-next-agenda-item.entity';

export const MEETING_NEXT_AGENDA_ITEM_REPOSITORY =
  'MEETING_NEXT_AGENDA_ITEM_REPOSITORY';

/**
 * `meeting_next_agenda_items` (#5790): action items of posted minutes sent
 * to the next meeting's agenda. Chapter-first on every read and write.
 */
export interface IMeetingNextAgendaItemRepository {
  /**
   * Writes one. Idempotent on `ai_suggestion_id`: a suggestion sent twice is
   * one item, and the row already there is returned.
   */
  insert(row: NewMeetingNextAgendaItem): Promise<MeetingNextAgendaItem>;

  /** Takes one back: the suggestion it came from couldn't be closed. */
  delete(chapterId: string, id: string): Promise<void>;

  /** The one a suggestion was sent as, if any. */
  findBySuggestion(
    chapterId: string,
    suggestionId: string,
  ): Promise<MeetingNextAgendaItem | null>;

  /** Every item sent from these minutes, oldest first. */
  listForMeetings(
    chapterId: string,
    meetingIds: readonly string[],
  ): Promise<MeetingNextAgendaItem[]>;
}
