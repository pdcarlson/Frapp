import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MEETING_DATE_REMINDER_REPOSITORY } from '#domain/repositories/meeting-date-reminder.repository.interface';
import type {
  IMeetingDateReminderRepository,
  MeetingDateReminder,
} from '#domain/repositories/meeting-date-reminder.repository.interface';
import { MeetingService } from './meeting.service';

/** How far ahead a reminder may be set, as for a chat message's. */
const REMINDER_MAX_AHEAD_DAYS = 365;
/**
 * How far in the past a new time may be and still count as "now": a client
 * clock running a little fast sets a reminder the next sweep sends.
 */
const REMINDER_PAST_GRACE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One of the caller's reminders on a minutes' Coming up date. */
export interface MeetingDateReminderRef {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  text: string;
  remind_at: string;
}

const refOf = (row: MeetingDateReminder): MeetingDateReminderRef => ({
  id: row.id,
  date: row.day,
  text: row.text,
  remind_at: row.remind_at,
});

/**
 * "Remind me" on a minutes' Coming up date (#5672 step 2,
 * `spec/behavior/meetings.md` § Reading minutes → Coming up, tracked).
 *
 * Private on the same three legs as a chat message's reminder
 * (`ChatReminderService`): no route takes a user id, every query filters on
 * the caller, and the table has RLS on with no policies. Anyone who can read
 * the minutes may set one; the minutes' own read rule (`MeetingService.get`)
 * decides, and answers anyone it leaves out with the 404 a missing id gets.
 */
@Injectable()
export class MeetingDateReminderService {
  constructor(
    @Inject(MEETING_DATE_REMINDER_REPOSITORY)
    private readonly reminders: IMeetingDateReminderRepository,
    private readonly meetings: MeetingService,
  ) {}

  /** The caller's reminders still waiting on these minutes, soonest first. */
  async list(
    chapterId: string,
    userId: string,
    meetingId: string,
  ): Promise<MeetingDateReminderRef[]> {
    if (!(await this.meetings.canRead(chapterId, meetingId, userId))) {
      throw new NotFoundException('Minutes not found');
    }
    const rows = await this.reminders.findByUserAndMeeting(
      userId,
      chapterId,
      meetingId,
    );
    return rows.map(refOf);
  }

  /**
   * Sets the caller's reminder on one of the minutes' dates, or moves the
   * one there is. The date has to be in the minutes as they read now, so a
   * push never quotes words the minutes don't say.
   */
  async set(
    chapterId: string,
    userId: string,
    meetingId: string,
    input: { date: string; text: string; remindAt: Date },
    now: Date = new Date(),
  ): Promise<MeetingDateReminderRef> {
    const at = input.remindAt.getTime();
    if (Number.isNaN(at)) {
      throw new BadRequestException('remind_at must be a date and time');
    }
    if (at < now.getTime() - REMINDER_PAST_GRACE_MS) {
      throw new BadRequestException('remind_at must not be in the past');
    }
    if (at > now.getTime() + REMINDER_MAX_AHEAD_DAYS * DAY_MS) {
      throw new BadRequestException(
        `remind_at must be within ${REMINDER_MAX_AHEAD_DAYS} days`,
      );
    }
    const view = await this.meetings.get(chapterId, meetingId, userId);
    const text = input.text.trim();
    const item = view.content.dates.find(
      (date) => date.date === input.date && date.text.trim() === text,
    );
    if (!item) {
      throw new NotFoundException(
        'That date isn’t in these minutes anymore. Reload them.',
      );
    }
    const row = await this.reminders.upsert({
      userId,
      chapterId,
      meetingId,
      day: item.date,
      text,
      remindAt: input.remindAt.toISOString(),
    });
    return refOf(row);
  }

  /**
   * Cancels one of the caller's reminders. It doesn't read the minutes, so a
   * member who lost them can still cancel their own, and every outcome is the
   * same 204 whether there was a reminder or not.
   */
  async clear(
    chapterId: string,
    userId: string,
    meetingId: string,
    reminderId: string,
  ): Promise<void> {
    await this.reminders.delete(userId, chapterId, meetingId, reminderId);
  }
}
