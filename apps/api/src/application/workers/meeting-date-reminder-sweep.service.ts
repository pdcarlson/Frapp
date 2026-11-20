import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { MEETING_DATE_REMINDER_REPOSITORY } from '#domain/repositories/meeting-date-reminder.repository.interface';
import type {
  IMeetingDateReminderRepository,
  MeetingDateReminder,
} from '#domain/repositories/meeting-date-reminder.repository.interface';
import { MeetingService } from '../services/meeting.service';
import { NotificationService } from '../services/notification.service';
import { REMINDER_NOTIFICATION_CATEGORY } from './chat-reminder-sweep.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** Due reminders one read takes. A tick keeps reading while a read comes back full. */
export const DATE_REMINDER_SWEEP_BATCH = 50;
/** Reads one tick makes at most, as the chat reminder sweep caps its own. */
export const DATE_REMINDER_SWEEP_MAX_BATCHES = 10;

/**
 * "Wednesday, December 2" for a `YYYY-MM-DD` day. Read as a calendar day,
 * not an instant, so the server's time zone never moves it.
 */
export function writtenDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Sends each Coming up date reminder's push when its time comes (#5672 step
 * 2, `spec/behavior/meetings.md` § Reading minutes → Coming up, tracked).
 *
 * Every replica runs this cron, so each row is claimed with a
 * compare-and-delete before its push: only the replica whose delete matched
 * sends, and a reminder the member moved in the meantime waits for its new
 * time. Nothing is kept once it fires; the push and its inbox row are the
 * record. No push goes out for minutes the member can no longer read.
 */
@Injectable()
export class MeetingDateReminderSweepService {
  private readonly logger = new Logger(MeetingDateReminderSweepService.name);
  /** One tick at a time on this replica; a slow tick skips the next. */
  private running = false;

  constructor(
    @Inject(MEETING_DATE_REMINDER_REPOSITORY)
    private readonly reminders: IMeetingDateReminderRepository,
    private readonly meetings: MeetingService,
    private readonly notificationService: NotificationService,
  ) {}

  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleDateReminderSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(Date.now());
    } finally {
      this.running = false;
    }
  }

  async sweep(now: number): Promise<{ fired: number; pushed: number }> {
    const at = new Date(now).toISOString();
    const tally = { fired: 0, pushed: 0 };
    for (let batch = 0; batch < DATE_REMINDER_SWEEP_MAX_BATCHES; batch++) {
      const due = await this.reminders.findDue(at, DATE_REMINDER_SWEEP_BATCH);
      for (const reminder of due) {
        if (!(await this.reminders.claimDue(reminder))) continue;
        tally.fired += 1;
        try {
          if (await this.deliver(reminder)) tally.pushed += 1;
        } catch (error) {
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'meeting-date-reminder-push',
            message: `date reminder ${reminder.id} fired but its notification failed`,
            error,
          });
        }
      }
      // A short read is the last of what is due. A full one may hold rows
      // another replica claimed first, which drop out of the next read.
      if (due.length < DATE_REMINDER_SWEEP_BATCH) break;
    }
    return tally;
  }

  /** Sends the reminder's notification; false when there was none to send. */
  private async deliver(reminder: MeetingDateReminder): Promise<boolean> {
    // The minutes' own read rule, as of now: minutes the member can no
    // longer open get no push.
    const view = await this.meetings
      .get(reminder.chapter_id, reminder.meeting_id, reminder.user_id)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
    if (!view) return false;
    const eventId = view.meeting.event_id;
    await this.notificationService.notifyUser(
      reminder.user_id,
      reminder.chapter_id,
      {
        title: 'Reminder',
        body: `${writtenDay(reminder.day)}: ${reminder.text}`,
        category: REMINDER_NOTIFICATION_CATEGORY,
        data: {
          // Opens the minutes, as the minutes' own pushes do.
          target: eventId
            ? { screen: 'events', eventId, meetingId: reminder.meeting_id }
            : { screen: 'events', meetingId: reminder.meeting_id },
          reminder: true,
        },
      },
    );
    return true;
  }
}
