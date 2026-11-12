import { Meeting, MeetingTemplate } from '../entities/meeting.entity';

export const MEETING_REPOSITORY = 'MEETING_REPOSITORY';

/** The fields a save may write; the service decides every one of them. */
export type MeetingWrite = Partial<
  Pick<
    Meeting,
    | 'event_name'
    | 'event_start_time'
    | 'meeting_type'
    | 'other_label'
    | 'status'
    | 'content'
    | 'updated_by'
    | 'posted_by'
    | 'posted_at'
  >
>;

export interface IMeetingRepository {
  findById(chapterId: string, id: string): Promise<Meeting | null>;
  findByEvent(chapterId: string, eventId: string): Promise<Meeting | null>;
  /** The chapter's minutes, newest meeting first, at most `limit`. */
  findByChapter(chapterId: string, limit: number): Promise<Meeting[]>;
  /**
   * Resolves to `null` when the event already has minutes (the unique index
   * on `event_id` won), so the caller can answer with the ones that exist.
   */
  create(data: Partial<Meeting>): Promise<Meeting | null>;
  /**
   * Writes `data` only while the row is still at `expectedUpdatedAt`, so two
   * officers saving the same minutes can't silently overwrite each other.
   * `null` when the row moved on or is gone.
   */
  update(
    chapterId: string,
    id: string,
    expectedUpdatedAt: string,
    data: MeetingWrite,
  ): Promise<Meeting | null>;
  delete(chapterId: string, id: string): Promise<void>;
  findTemplate(chapterId: string): Promise<MeetingTemplate | null>;
  upsertTemplate(
    chapterId: string,
    sections: string[],
    updatedBy: string,
  ): Promise<MeetingTemplate>;
}
