import type { MeetingStatus, MeetingType } from '@repo/validation';

/**
 * A meeting's minutes (`meetings`, #4312; `spec/behavior/meetings.md`). One
 * row per event at most. Posted minutes are read by the members the event
 * invites; a draft by its author and `meetings:edit` holders.
 */
export interface Meeting {
  id: string;
  chapter_id: string;
  /** `null` once the event is deleted; the minutes stay. */
  event_id: string | null;
  /** The event's name and start, copied on every save. */
  event_name: string;
  event_start_time: string;
  meeting_type: MeetingType;
  other_label: string | null;
  status: MeetingStatus;
  /**
   * The minutes, stored loosely: read through `readMeetingContent` from
   * `@repo/validation`, never trusted as typed.
   */
  content: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A chapter's minutes template (`meeting_templates`). */
export interface MeetingTemplate {
  chapter_id: string;
  /** Section keys, read through `normalizeMeetingSections`. */
  sections: string[];
  updated_by: string | null;
  updated_at: string;
}

export const MEETING_DRAFT_ROW_STATUSES = [
  'drafting',
  'ready',
  'applied',
  'failed',
] as const;
export type MeetingDraftRowStatus = (typeof MEETING_DRAFT_ROW_STATUSES)[number];

/**
 * One meeting's draft-from-notes request (`meeting_drafts`, #4312): the
 * officer's notes, where the AI run stands, and what it wrote. At most one
 * per meeting; asking again replaces it.
 *
 * This is the only place the notes are kept, and they are kept only while
 * the minutes are a draft: the row is deleted when the minutes are posted or
 * deleted, when the officer clears their notes, when the officer deletes
 * their account, and 30 days after the request whatever else happened
 * (`spec/behavior/meetings.md` § Drafting from notes).
 */
export interface MeetingDraft {
  meeting_id: string;
  chapter_id: string;
  /**
   * A fresh id per request. The AI run carries it, so a run that finishes
   * after the officer asked again writes nothing.
   */
  request_id: string;
  /** The `ai_runs` row doing the work; null until it is queued. */
  run_id: string | null;
  requested_by: string | null;
  /** The officer's notes, as typed. Never logged. */
  notes: string;
  /** The meeting's calendar day where the officer is, `YYYY-MM-DD`. */
  meeting_date: string;
  /**
   * The minutes' `updated_at` when the draft was asked for. The draft is put
   * into the minutes only while they are still at this version.
   */
  base_updated_at: string;
  status: MeetingDraftRowStatus;
  /** A `MeetingDraftFailure` from `@repo/validation`; set when failed. */
  failure_code: string | null;
  /**
   * `{ content, review }`: the drafted sections and what to check them
   * against. Read through the schemas in `@repo/validation`, never trusted
   * as typed.
   */
  result: Record<string, unknown> | null;
  requested_at: string;
  finished_at: string | null;
}

export const MEETING_RECORDING_ROW_STATUSES = [
  'uploading',
  'transcribing',
  'ready',
  'failed',
] as const;
export type MeetingRecordingRowStatus =
  (typeof MEETING_RECORDING_ROW_STATUSES)[number];

/**
 * One meeting's uploaded recording (`meeting_recordings`, #712): where its
 * upload and its transcription stand, and the transcript. At most one per
 * meeting; uploading again replaces it.
 *
 * The audio is in the `meeting-audio` bucket only until the transcript is
 * written or the transcription fails for good. The row, and the transcript
 * in it, is kept only while the minutes are a draft, as the officer's notes
 * are (`spec/behavior/meetings.md` § Uploading a recording).
 */
export interface MeetingRecording {
  meeting_id: string;
  chapter_id: string;
  /**
   * A fresh id per upload. The AI run carries it, so a run that finishes
   * after the officer uploaded again writes nothing.
   */
  upload_id: string;
  uploaded_by: string | null;
  /** Where the audio is, while it may still be there; null once deleted. */
  storage_path: string | null;
  /** The file's own name. Shown to the officer; never logged. */
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** What the officer's browser read off the file, then what the provider measured. */
  duration_seconds: number;
  /** When the officer confirmed the room was told it was being recorded. */
  notice_confirmed_at: string;
  /** When the members who were at the meeting were told; once per meeting. */
  attendees_notified_at: string | null;
  status: MeetingRecordingRowStatus;
  /** A `MeetingRecordingFailure` from `@repo/validation`; set when failed. */
  failure_code: string | null;
  /** The `ai_runs` row doing the work; null until it is queued. */
  run_id: string | null;
  /** The provider's id for the transcription while it is in progress. */
  provider_job_id: string | null;
  /** One line per speaker turn; set exactly when `ready`. Never logged. */
  transcript: string | null;
  speaker_count: number | null;
  created_at: string;
  finished_at: string | null;
}
