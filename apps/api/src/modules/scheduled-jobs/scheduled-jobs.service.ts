import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AttendanceService,
  CHECK_IN_GRACE_PERIOD_MINUTES,
} from '../../application/services/attendance.service';
import { NotificationService } from '../../application/services/notification.service';
import { ChapterWorkflowsService } from '../../application/services/chapter-workflows.service';
import {
  ScheduledJobsRepository,
  type SweepInvoiceRow,
  type SweepTaskRow,
} from './scheduled-jobs.repository';

/**
 * How far back the hourly auto-absent sweep reaches. Comfortably longer than
 * the sweep interval so a restart or a missed tick still closes out the
 * events it skipped, without re-walking history every hour.
 */
const AUTO_ABSENT_LOOKBACK_HOURS = 24;

/**
 * Reminder lead time. `spec/behavior/tasks.md` fixes this at 1 day for tasks;
 * invoices follow the same convention (`spec/behavior/billing.md`).
 */
const DUE_SOON_LEAD_DAYS = 1;

/**
 * How recently an entity must have *become* overdue to still earn a
 * notification.
 *
 * Without this bound the first sweep after deploy would notify every member
 * holding any historically overdue invoice or task — the dispatch log makes
 * that a one-time blast rather than a loop, but a one-time blast is still the
 * wrong first impression of the feature.
 */
const OVERDUE_LOOKBACK_DAYS = 7;

/**
 * Upper bound on a chapter's configurable dues grace (mirrors
 * `ChapterWorkflowsService`). Used only to size the invoice query window; the
 * per-chapter grace is applied exactly, in code.
 */
const MAX_DUES_GRACE_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC, matching the `date` columns being compared. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Scheduled workers for the time-based behavior the spec requires but that no
 * user action triggers: attendance auto-absent, invoice due/overdue reminders,
 * and task due/overdue reminders.
 *
 * Every sweep takes an explicit `now` so tests drive a fixed clock; the
 * `@Cron` handlers are thin wrappers that pass the real one.
 *
 * **Idempotency.** Auto-absent delegates to `AttendanceService.markAutoAbsent`,
 * which already skips members holding an attendance record, so re-running it
 * is a no-op. The reminder sweeps claim a row in
 * `scheduled_notification_dispatches` before sending — see
 * `ScheduledJobsRepository.claimDispatch`. That claim is what makes these
 * safe on more than one replica: a plain `@Cron` fires on every instance.
 *
 * **Failure isolation.** One chapter's bad data must not stop the sweep, so
 * every per-entity step is caught and logged individually.
 */
@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly repository: ScheduledJobsRepository,
    private readonly attendanceService: AttendanceService,
    private readonly notificationService: NotificationService,
    private readonly workflows: ChapterWorkflowsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoAbsentSweep(): Promise<void> {
    await this.sweepAutoAbsent(new Date());
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleInvoiceReminderSweep(): Promise<void> {
    await this.sweepInvoiceReminders(new Date());
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleTaskReminderSweep(): Promise<void> {
    await this.sweepTaskReminders(new Date());
  }

  /**
   * Mark required non-attendees absent for every event whose grace period
   * closed since the last sweep.
   *
   * The cutoff is `now - grace`, the same arithmetic `markAutoAbsent`
   * enforces, so no candidate is ever rejected for being too early.
   */
  async sweepAutoAbsent(now: Date): Promise<{ events: number }> {
    const graceMs = CHECK_IN_GRACE_PERIOD_MINUTES * 60 * 1000;
    const endedBefore = new Date(now.getTime() - graceMs);
    const endedAfter = new Date(
      now.getTime() - AUTO_ABSENT_LOOKBACK_HOURS * 60 * 60 * 1000,
    );

    const events = await this.repository.findEventsPendingAutoAbsent(
      endedAfter,
      endedBefore,
    );

    let processed = 0;
    for (const event of events) {
      try {
        await this.attendanceService.markAutoAbsent(event.id, event.chapter_id);
        processed += 1;
      } catch (error) {
        this.logger.error(
          `auto-absent sweep: event ${event.id} failed`,
          error as Error,
        );
      }
    }

    if (events.length > 0) {
      this.logger.log(
        `auto-absent sweep: processed ${processed}/${events.length} events`,
      );
    }
    return { events: processed };
  }

  /**
   * Notify members about invoices coming due and invoices that have just
   * become overdue.
   *
   * Overdue is `due_date` + the chapter's dues grace (`wf_dues_grace`), so the
   * threshold is per chapter and can only be applied after the rows are known.
   * The query window is therefore widened by the maximum configurable grace
   * and narrowed exactly, in code.
   */
  async sweepInvoiceReminders(now: Date): Promise<{ sent: number }> {
    const dueSoonKey = toDateKey(addDays(now, DUE_SOON_LEAD_DAYS));
    const windowStart = toDateKey(
      addDays(now, -(OVERDUE_LOOKBACK_DAYS + MAX_DUES_GRACE_DAYS)),
    );

    const invoices = await this.repository.findOpenInvoicesDueBetween(
      windowStart,
      dueSoonKey,
    );

    const graceByChapter = new Map<string, number>();
    let sent = 0;

    for (const invoice of invoices) {
      try {
        if (invoice.due_date === dueSoonKey) {
          if (await this.notifyInvoiceDueSoon(invoice)) sent += 1;
          continue;
        }

        let graceDays = graceByChapter.get(invoice.chapter_id);
        if (graceDays === undefined) {
          graceDays = await this.workflows.getDuesGraceDays(invoice.chapter_id);
          graceByChapter.set(invoice.chapter_id, graceDays);
        }

        if (this.isNewlyOverdue(invoice.due_date, graceDays, now)) {
          if (await this.notifyInvoiceOverdue(invoice)) sent += 1;
        }
      } catch (error) {
        this.logger.error(
          `invoice sweep: invoice ${invoice.id} failed`,
          error as Error,
        );
      }
    }

    if (sent > 0) this.logger.log(`invoice sweep: sent ${sent} reminders`);
    return { sent };
  }

  /**
   * Notify assignees about tasks coming due, and assignee plus assigner about
   * tasks that have just gone overdue (`spec/behavior/tasks.md`).
   */
  async sweepTaskReminders(now: Date): Promise<{ sent: number }> {
    const dueSoonKey = toDateKey(addDays(now, DUE_SOON_LEAD_DAYS));
    const todayKey = toDateKey(now);
    const windowStart = toDateKey(addDays(now, -OVERDUE_LOOKBACK_DAYS));

    const tasks = await this.repository.findIncompleteTasksDueBetween(
      windowStart,
      dueSoonKey,
    );

    let sent = 0;
    for (const task of tasks) {
      try {
        if (task.due_date === dueSoonKey) {
          if (await this.notifyTaskDueSoon(task)) sent += 1;
        } else if (task.due_date < todayKey) {
          if (await this.notifyTaskOverdue(task)) sent += 1;
        }
      } catch (error) {
        this.logger.error(`task sweep: task ${task.id} failed`, error as Error);
      }
    }

    if (sent > 0) this.logger.log(`task sweep: sent ${sent} reminders`);
    return { sent };
  }

  /**
   * True when `due_date` + grace fell inside the lookback window ending now.
   * Both bounds matter: the upper keeps the sweep from firing before grace has
   * actually elapsed, the lower keeps it from resurrecting old debt.
   */
  private isNewlyOverdue(
    dueDate: string,
    graceDays: number,
    now: Date,
  ): boolean {
    const overdueKey = toDateKey(
      addDays(new Date(`${dueDate}T00:00:00Z`), graceDays),
    );
    const todayKey = toDateKey(now);
    const lookbackKey = toDateKey(addDays(now, -OVERDUE_LOOKBACK_DAYS));
    return overdueKey <= todayKey && overdueKey >= lookbackKey;
  }

  private async notifyInvoiceDueSoon(invoice: SweepInvoiceRow) {
    const claimed = await this.repository.claimDispatch(
      invoice.chapter_id,
      'INVOICE',
      invoice.id,
      'DUE_SOON',
    );
    if (!claimed) return false;

    await this.notificationService.notifyUser(
      invoice.user_id,
      invoice.chapter_id,
      {
        title: 'Payment due tomorrow',
        body: `${invoice.title} (${formatUsd(invoice.amount)}) is due tomorrow.`,
        category: 'billing',
        data: { invoiceId: invoice.id, threshold: 'DUE_SOON' },
      },
    );
    return true;
  }

  private async notifyInvoiceOverdue(invoice: SweepInvoiceRow) {
    const claimed = await this.repository.claimDispatch(
      invoice.chapter_id,
      'INVOICE',
      invoice.id,
      'OVERDUE',
    );
    if (!claimed) return false;

    await this.notificationService.notifyUser(
      invoice.user_id,
      invoice.chapter_id,
      {
        title: 'Payment overdue',
        body: `${invoice.title} (${formatUsd(invoice.amount)}) is past due.`,
        category: 'billing',
        data: { invoiceId: invoice.id, threshold: 'OVERDUE' },
      },
    );
    return true;
  }

  private async notifyTaskDueSoon(task: SweepTaskRow) {
    const claimed = await this.repository.claimDispatch(
      task.chapter_id,
      'TASK',
      task.id,
      'DUE_SOON',
    );
    if (!claimed) return false;

    await this.notificationService.notifyUser(
      task.assignee_id,
      task.chapter_id,
      {
        title: 'Task due tomorrow',
        body: `"${task.title}" is due tomorrow.`,
        category: 'tasks',
        data: { taskId: task.id, threshold: 'DUE_SOON' },
      },
    );
    return true;
  }

  /**
   * Spec requires assignee *and* admin. The admin notified is the task's
   * `created_by` — the person who assigned it, and the one accountable for
   * chasing it — rather than a fan-out to every `tasks:manage` holder, which
   * would turn one overdue task into an unbounded notification burst.
   *
   * A self-assigned task collapses to a single notification.
   */
  private async notifyTaskOverdue(task: SweepTaskRow) {
    const claimed = await this.repository.claimDispatch(
      task.chapter_id,
      'TASK',
      task.id,
      'OVERDUE',
    );
    if (!claimed) return false;

    const recipients = new Set([task.assignee_id, task.created_by]);
    for (const userId of recipients) {
      await this.notificationService.notifyUser(userId, task.chapter_id, {
        title: 'Task overdue',
        body: `"${task.title}" is past its due date.`,
        category: 'tasks',
        data: { taskId: task.id, threshold: 'OVERDUE' },
      });
    }
    return true;
  }
}
