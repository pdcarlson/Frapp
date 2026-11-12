import type {
  MeetingRecording,
  MeetingRecordingRowStatus,
} from '../entities/meeting.entity';

export const MEETING_RECORDING_REPOSITORY = 'MEETING_RECORDING_REPOSITORY';

/** A new upload: everything but what the database and the run fill in. */
export type NewMeetingRecording = Pick<
  MeetingRecording,
  | 'meeting_id'
  | 'chapter_id'
  | 'upload_id'
  | 'uploaded_by'
  | 'storage_path'
  | 'file_name'
  | 'mime_type'
  | 'size_bytes'
  | 'duration_seconds'
  | 'notice_confirmed_at'
>;

/** What moving a recording on may change. */
export type MeetingRecordingStep = Partial<
  Pick<
    MeetingRecording,
    | 'status'
    | 'failure_code'
    | 'run_id'
    | 'storage_path'
    | 'provider_job_id'
    | 'transcript'
    | 'speaker_count'
    | 'duration_seconds'
    | 'finished_at'
  >
>;

export interface IMeetingRecordingRepository {
  find(chapterId: string, meetingId: string): Promise<MeetingRecording | null>;
  /**
   * Stores an upload as `uploading`, replacing the meeting's earlier one (its
   * transcript and its failure) in the same write. Whether the meeting's
   * attendees have been told is kept across the replacement.
   */
  start(data: NewMeetingRecording): Promise<MeetingRecording>;
  /**
   * Moves a recording on, only while it is still this upload and still in
   * one of `from`. `null` when the officer uploaded again, removed it, or it
   * had already moved.
   */
  step(
    chapterId: string,
    meetingId: string,
    uploadId: string,
    from: readonly MeetingRecordingRowStatus[],
    step: MeetingRecordingStep,
  ): Promise<MeetingRecording | null>;
  /**
   * Records that the meeting's attendees were told, once. `false` when they
   * already had been, so two requests at once send one notice.
   */
  claimAttendeeNotice(
    chapterId: string,
    meetingId: string,
    at: string,
  ): Promise<boolean>;
  /** Gives the claim back when nothing could be sent. */
  releaseAttendeeNotice(chapterId: string, meetingId: string): Promise<void>;
  delete(chapterId: string, meetingId: string): Promise<void>;
  /**
   * Every row that still names a file, in every chapter, oldest first: what
   * the audio sweep reads. Rows name a file for minutes, so this is short.
   */
  listWithAudio(limit: number): Promise<MeetingRecording[]>;
  /**
   * Of these storage paths, the ones a row still names as its file. The
   * audio sweep deletes every object that is not among them.
   */
  pathsStillNamed(paths: readonly string[]): Promise<string[]>;
  /**
   * Deletes every recording uploaded before `cutoff`, in every chapter: the
   * retention sweep. Resolves to how many went.
   */
  deleteCreatedBefore(cutoff: string): Promise<number>;
}
