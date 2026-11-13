import type { MeetingNote } from '../entities/meeting.entity';

export const MEETING_NOTES_REPOSITORY = 'MEETING_NOTES_REPOSITORY';

/**
 * Each note-taker's own notes for one meeting's unposted minutes
 * (`meeting_notes`, #4935). Read and written with the service role; who sees
 * whose notes is `MeetingNotesService`'s rule.
 */
export interface IMeetingNotesRepository {
  /** Every note-taker on the meeting, oldest first. */
  findByMeeting(chapterId: string, meetingId: string): Promise<MeetingNote[]>;
  find(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MeetingNote | null>;
  /** The meetings `userId` takes notes on, in this chapter. */
  findByUser(chapterId: string, userId: string): Promise<MeetingNote[]>;
  /**
   * Writes the member's notes, making them a note-taker if they weren't.
   * `addedBy` is kept when the row exists.
   */
  upsert(row: {
    meeting_id: string;
    chapter_id: string;
    user_id: string;
    notes: string;
    added_by: string | null;
  }): Promise<MeetingNote>;
  /** Adds a member with empty notes; a member already there is left as is. */
  add(row: {
    meeting_id: string;
    chapter_id: string;
    user_id: string;
    added_by: string;
  }): Promise<void>;
  delete(chapterId: string, meetingId: string, userId: string): Promise<void>;
  deleteCreatedBefore(cutoff: string): Promise<number>;
}
