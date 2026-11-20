import type { MeetingNoMinutes } from '#domain/entities/meeting-no-minutes.entity';

export const MEETING_NO_MINUTES_REPOSITORY = 'MEETING_NO_MINUTES_REPOSITORY';

/**
 * Meetings marked "No minutes" (`meeting_no_minutes`). Read and written with
 * the service role; who may mark one is `MeetingNoMinutesService`'s rule.
 */
export interface IMeetingNoMinutesRepository {
  /** The chapter's marks, one per meeting that ended with none. A mark leaves with its event, its minutes, or an undo. */
  list(chapterId: string): Promise<MeetingNoMinutes[]>;
  /** Marks the event; marking it again keeps the first mark. */
  mark(chapterId: string, eventId: string, userId: string): Promise<void>;
  /** Takes the mark off; one that isn't there is no error. */
  unmark(chapterId: string, eventId: string): Promise<void>;
}
