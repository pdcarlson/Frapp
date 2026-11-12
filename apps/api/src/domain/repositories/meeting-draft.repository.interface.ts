import type {
  MeetingDraft,
  MeetingDraftRowStatus,
} from '../entities/meeting.entity';

export const MEETING_DRAFT_REPOSITORY = 'MEETING_DRAFT_REPOSITORY';

/** A new request: everything but what the database and the run fill in. */
export type NewMeetingDraft = Pick<
  MeetingDraft,
  | 'meeting_id'
  | 'chapter_id'
  | 'request_id'
  | 'requested_by'
  | 'notes'
  | 'meeting_date'
  | 'base_updated_at'
>;

/** How a request ended. */
export interface MeetingDraftOutcome {
  status: Exclude<MeetingDraftRowStatus, 'drafting'>;
  failure_code?: string | null;
  result?: Record<string, unknown> | null;
}

export interface IMeetingDraftRepository {
  find(chapterId: string, meetingId: string): Promise<MeetingDraft | null>;
  /**
   * Stores a request, replacing the meeting's earlier one (its notes, its
   * result and its failure) in the same write.
   */
  replace(data: NewMeetingDraft): Promise<MeetingDraft>;
  /** Names the run doing the work, while the request is still this one. */
  setRun(
    chapterId: string,
    meetingId: string,
    requestId: string,
    runId: string,
  ): Promise<void>;
  /**
   * Ends a request, only while it is still this one and still in one of
   * `from`. `null` when the officer asked again, cleared their notes, or it
   * had already ended.
   */
  finish(
    chapterId: string,
    meetingId: string,
    requestId: string,
    from: readonly MeetingDraftRowStatus[],
    outcome: MeetingDraftOutcome,
  ): Promise<MeetingDraft | null>;
  delete(chapterId: string, meetingId: string): Promise<void>;
  /**
   * Deletes every request made before `cutoff`, in every chapter: the
   * retention sweep. Resolves to how many went.
   */
  deleteRequestedBefore(cutoff: string): Promise<number>;
}
