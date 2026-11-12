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
