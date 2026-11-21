import type { MeetingDateReminder } from '../entities/meeting-date-reminder.entity';

export type { MeetingDateReminder };

export const MEETING_DATE_REMINDER_REPOSITORY =
  'MEETING_DATE_REMINDER_REPOSITORY';

/**
 * Private reminders on Coming up dates in minutes (#5672 step 2,
 * `meeting_date_reminders`).
 *
 * Every member-facing method filters on the caller's `user_id` and chapter,
 * and none answers a question about anyone else's reminders. Only the
 * sweep's two methods walk every chapter, by design: they read and claim due
 * rows across the deployment.
 */
export interface IMeetingDateReminderRepository {
  /**
   * Sets the caller's reminder on a date, or moves the one there is: one per
   * member per date (its day and words).
   */
  upsert(input: {
    userId: string;
    chapterId: string;
    meetingId: string;
    day: string;
    text: string;
    remindAt: string;
  }): Promise<MeetingDateReminder>;
  /** Removes one of the caller's reminders. Idempotent. */
  delete(
    userId: string,
    chapterId: string,
    meetingId: string,
    reminderId: string,
  ): Promise<void>;
  /** The caller's reminders still waiting on one meeting's minutes. */
  findByUserAndMeeting(
    userId: string,
    chapterId: string,
    meetingId: string,
  ): Promise<MeetingDateReminder[]>;
  /** Reminders due at `now`, oldest first, across every chapter. */
  findDue(now: string, limit: number): Promise<MeetingDateReminder[]>;
  /**
   * Claims a due reminder for this replica by deleting it, only if it still
   * has the time that was read: two replicas never both push, and a reminder
   * moved between the read and the claim waits for its new time. True when
   * this call won.
   */
  claimDue(
    reminder: Pick<MeetingDateReminder, 'id' | 'remind_at'>,
  ): Promise<boolean>;
}
