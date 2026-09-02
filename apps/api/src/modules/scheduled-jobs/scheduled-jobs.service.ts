import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import {
  AttendanceService,
  CHECK_IN_GRACE_PERIOD_MINUTES,
} from '../../application/services/attendance.service';
import { NotificationService } from '../../application/services/notification.service';
import { ChapterWorkflowsService } from '../../application/services/chapter-workflows.service';
import { PollService } from '../../application/services/poll.service';
import {
  ReportRetentionService,
  type ReportSweepResult,
} from '../../application/services/report-retention.service';
import {
  ScheduledJobsRepository,
  type DispatchEntityType,
  type DispatchThreshold,
  type SweepInvoiceRow,
  type SweepTaskRow,
  type SweepPollRow,
} from './scheduled-jobs.repository';

/**
 * How far back the hourly auto-absent sweep reaches. Comfortably longer than
 * the sweep interval so a restart or a missed tick still closes out the
 * events it skipped, without re-walking history every hour.
 */
const AUTO_ABSENT_LOOKBACK_HOURS = 24;

/**
 * How far back the poll-expiry sweep reaches. Comfortably longer than the
 * sweep interval (`EVERY_5_MINUTES`) for the same reason as
 * `AUTO_ABSENT_LOOKBACK_HOURS` — a restart or missed tick still announces the
 * polls it skipped instead of leaving them silently unannounced forever.
 */
const POLL_EXPIRY_LOOKBACK_HOURS = 24;

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
 * `MAX_GRACE_DAYS` in `ChapterWorkflowsService`). Used only to size the
 * invoice query window; the per-chapter grace is applied exactly, in code.
 * Raising the clamp there without raising this would narrow the window below
 * what long-grace chapters need, so the two must move together.
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
 * `scheduled_notification_dispatches` before sending — see `claimAndNotify`.
 * That claim is what makes these safe on more than one replica: a plain
 * `@Cron` fires on every instance.
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
    private readonly reportRetention: ReportRetentionService,
    private readonly pollService: PollService,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoAbsentSweep(): Promise<void> {
    await this.sweepAutoAbsent(new Date());
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePollExpirySweep(): Promise<void> {
    await this.sweepExpiredPolls(new Date());
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
   * The only handler here that needs its own catch.
   *
   * The other three reach the database through `fetchAllPages`, which absorbs
   * a query error and returns `[]`, so they cannot reject. This one reaches
   * *storage*, and a failure listing the bucket root propagates. An unhandled
   * rejection out of a `@Cron` handler is not a logged blip — Node's default
   * `--unhandled-rejections=throw` turns it into an uncaught exception and
   * takes the API process down, hourly. A sweep that cannot start must skip
   * this tick loudly, not restart the service.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleReportRetentionSweep(): Promise<void> {
    try {
      await this.sweepExpiredReports(new Date());
    } catch (error) {
      this.logger.error(
        'report retention sweep: could not enumerate the reports bucket; skipping this tick',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Reap generated report PDFs past their retention window
   * (`spec/behavior/data-retention.md`).
   *
   * Hourly rather than daily: the window is 24h, so an hourly tick deletes an
   * expired export within an hour of it expiring instead of leaving a
   * PII-bearing snapshot for up to a further day.
   *
   * This is the one sweep here that needs no `scheduled_notification_dispatches`
   * claim. The others guard against a *duplicate side effect* — two replicas
   * sending the same reminder twice. Deleting a storage object is idempotent:
   * Supabase's `remove()` reports success for a key that is already gone, so
   * the replica that loses the race simply deletes nothing. A plain `@Cron`
   * firing on every instance is safe as-is.
   *
   * Thin by design — the service owns the whole sweep because it derives its
   * work list from storage, not from this repository.
   */
  async sweepExpiredReports(now: Date): Promise<ReportSweepResult> {
    return this.reportRetention.sweepExpiredReports(now);
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
      // Claim first. markAutoAbsent is idempotent, so this is not needed for
      // correctness — it stops the same event being re-processed on all 24
      // ticks inside the lookback window, and stops replicas racing each
      // other on event_attendance's unique constraint.
      //
      // `endedOn` derives from the event row, never from `now`, so every tick
      // in the lookback window computes the same claim key.
      const endedOn = toDateKey(new Date(event.end_time));

      try {
        const claimed = await this.repository.claimDispatch(
          event.chapter_id,
          'EVENT',
          event.id,
          'AUTO_ABSENT',
          endedOn,
        );
        if (!claimed) continue;

        try {
          await this.attendanceService.markAutoAbsent(
            event.id,
            event.chapter_id,
          );
          processed += 1;
        } catch (error) {
          this.logger.error(
            `auto-absent sweep: event ${event.id} failed`,
            error as Error,
          );
          // Release so the next tick retries rather than leaving the event
          // permanently unprocessed.
          await this.repository.releaseDispatch(
            event.chapter_id,
            'EVENT',
            event.id,
            'AUTO_ABSENT',
            endedOn,
          );
        }
      } catch (error) {
        this.logger.error(
          `auto-absent sweep: event ${event.id} could not be claimed`,
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
   * Announce, in-channel, every poll whose deadline passed since the last
   * sweep and that wasn't manually closed (`spec/behavior/polls.md`).
   *
   * Unlike the reminder sweeps this has exactly one "recipient" — the
   * channel itself, via a `system_audit` post — so it claims and notifies
   * directly rather than through `claimAndNotify`, which is shaped for
   * fanning a delivery out across multiple users.
   */
  async sweepExpiredPolls(now: Date): Promise<{ announced: number }> {
    const expiredAfter = new Date(
      now.getTime() - POLL_EXPIRY_LOOKBACK_HOURS * 60 * 60 * 1000,
    );

    const polls = await this.repository.findExpiredPollsPendingNotice(
      expiredAfter,
      now,
    );

    let announced = 0;
    for (const poll of polls) {
      try {
        if (await this.notifyPollExpired(poll)) announced += 1;
      } catch (error) {
        this.logger.error(
          `poll-expiry sweep: poll ${poll.id} failed`,
          error as Error,
        );
      }
    }

    if (announced > 0) {
      this.logger.log(`poll-expiry sweep: announced ${announced} polls`);
    }
    return { announced };
  }

  private async notifyPollExpired(poll: SweepPollRow): Promise<boolean> {
    // `expires_at` is a fixed instant per poll, so its date key is a stable
    // claim key across ticks — unlike `due_date`, which the invoice/task
    // sweeps read straight off the row, this is derived, but the same
    // stability requirement applies: every tick that sees this poll before
    // it's claimed must compute the same key.
    const dueDate = toDateKey(new Date(poll.expires_at));
    const claimed = await this.repository.claimDispatch(
      poll.chapter_id,
      'POLL',
      poll.id,
      'EXPIRED',
      dueDate,
    );
    if (!claimed) return false;

    try {
      await this.pollService.announceExpiry(poll.channel_id, poll.question);
      return true;
    } catch (error) {
      this.logger.error(
        `poll-expiry sweep: announcement for poll ${poll.id} failed`,
        error as Error,
      );
      await this.repository.releaseDispatch(
        poll.chapter_id,
        'POLL',
        poll.id,
        'EXPIRED',
        dueDate,
      );
      return false;
    }
  }

  /**
   * Notify members about invoices coming due and invoices that have just
   * become overdue.
   *
   * Overdue is strictly past `due_date` + the chapter's dues grace
   * (`wf_dues_grace`), matching `SupabaseFinancialInvoiceRepository.findOverdue`
   * — a reminder must never contradict what the member sees in their invoice
   * list. The threshold is per chapter and can only be applied after the rows
   * are known, so the query window is widened by the maximum configurable
   * grace and narrowed exactly, in code.
   */
  async sweepInvoiceReminders(now: Date): Promise<{ sent: number }> {
    const todayKey = toDateKey(now);
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
        if (invoice.due_date >= todayKey) {
          if (await this.notifyInvoiceDueSoon(invoice, todayKey)) sent += 1;
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
    const todayKey = toDateKey(now);
    const dueSoonKey = toDateKey(addDays(now, DUE_SOON_LEAD_DAYS));
    const windowStart = toDateKey(addDays(now, -OVERDUE_LOOKBACK_DAYS));

    const tasks = await this.repository.findIncompleteTasksDueBetween(
      windowStart,
      dueSoonKey,
    );

    let sent = 0;
    for (const task of tasks) {
      try {
        if (task.due_date >= todayKey) {
          if (await this.notifyTaskDueSoon(task, todayKey)) sent += 1;
        } else if (await this.notifyTaskOverdue(task)) {
          sent += 1;
        }
      } catch (error) {
        this.logger.error(`task sweep: task ${task.id} failed`, error as Error);
      }
    }

    if (sent > 0) this.logger.log(`task sweep: sent ${sent} reminders`);
    return { sent };
  }

  /**
   * True when `due_date` + grace fell strictly before today, and no earlier
   * than the lookback window.
   *
   * Strict on the upper bound: an invoice is overdue the day *after*
   * `due_date` + grace (`spec/behavior/billing.md`), so `<=` here would push
   * "past due" while the invoice list still showed it as current. The lower
   * bound keeps the sweep from resurrecting old debt.
   */
  private isNewlyOverdue(
    dueDate: string,
    graceDays: number,
    now: Date,
  ): boolean {
    const overdueKey = toDateKey(
      addDays(new Date(`${dueDate}T00:00:00Z`), graceDays),
    );
    return (
      overdueKey < toDateKey(now) &&
      overdueKey >= toDateKey(addDays(now, -OVERDUE_LOOKBACK_DAYS))
    );
  }

  /**
   * "tomorrow" for the normal lead time, "today" when a missed tick pushed the
   * reminder to the due date itself. The due-soon window spans both days so a
   * skipped sweep degrades to a late nudge instead of silence — but the copy
   * must not claim "tomorrow" for something due today.
   */
  private dueSoonPhrase(dueDate: string, todayKey: string): string {
    return dueDate === todayKey ? 'today' : 'tomorrow';
  }

  private notifyInvoiceDueSoon(invoice: SweepInvoiceRow, todayKey: string) {
    const when = this.dueSoonPhrase(invoice.due_date, todayKey);
    return this.claimAndNotify({
      chapterId: invoice.chapter_id,
      entityType: 'INVOICE',
      entityId: invoice.id,
      threshold: 'DUE_SOON',
      dueDate: invoice.due_date,
      recipients: [invoice.user_id],
      title: `Payment due ${when}`,
      body: `${invoice.title} (${formatUsd(invoice.amount)}) is due ${when}.`,
      category: 'billing',
      target: { screen: 'billing' },
    });
  }

  private notifyInvoiceOverdue(invoice: SweepInvoiceRow) {
    return this.claimAndNotify({
      chapterId: invoice.chapter_id,
      entityType: 'INVOICE',
      entityId: invoice.id,
      threshold: 'OVERDUE',
      dueDate: invoice.due_date,
      recipients: [invoice.user_id],
      title: 'Payment overdue',
      body: `${invoice.title} (${formatUsd(invoice.amount)}) is past due.`,
      category: 'billing',
      target: { screen: 'billing' },
    });
  }

  private notifyTaskDueSoon(task: SweepTaskRow, todayKey: string) {
    const when = this.dueSoonPhrase(task.due_date, todayKey);
    return this.claimAndNotify({
      chapterId: task.chapter_id,
      entityType: 'TASK',
      entityId: task.id,
      threshold: 'DUE_SOON',
      dueDate: task.due_date,
      recipients: [task.assignee_id],
      title: `Task due ${when}`,
      body: `"${task.title}" is due ${when}.`,
      category: 'tasks',
      target: { screen: 'tasks', taskId: task.id },
    });
  }

  /**
   * Spec requires assignee *and* admin. The admin notified is the task's
   * `created_by` — the person who assigned it, and the one accountable for
   * chasing it — rather than a fan-out to every `tasks:manage` holder, which
   * would turn one overdue task into an unbounded notification burst.
   *
   * A self-assigned task collapses to a single notification.
   *
   * The assigner's membership is re-checked before they are notified. Removing
   * a member deletes their `chapter_members` row but leaves `tasks.created_by`
   * pointing at them, so an officer who graduated or was removed would
   * otherwise keep receiving that chapter's task titles — and accumulate
   * `notifications` rows scoped to a chapter they no longer belong to. The
   * assignee needs no such check: an unfinished task is their own record, and
   * `markAutoAbsent`-style membership churn does not reassign it.
   */
  private async notifyTaskOverdue(task: SweepTaskRow) {
    const recipients = [task.assignee_id];

    if (task.created_by !== task.assignee_id) {
      const assigner = await this.memberRepo.findByUserAndChapter(
        task.created_by,
        task.chapter_id,
      );
      if (assigner) recipients.push(task.created_by);
    }

    return this.claimAndNotify({
      chapterId: task.chapter_id,
      entityType: 'TASK',
      entityId: task.id,
      threshold: 'OVERDUE',
      dueDate: task.due_date,
      recipients,
      title: 'Task overdue',
      body: `"${task.title}" is past its due date.`,
      category: 'tasks',
      target: { screen: 'tasks', taskId: task.id },
    });
  }

  /**
   * Claim a reminder, then deliver it to every recipient.
   *
   * Claiming before sending is what keeps two replicas from double-notifying.
   * The two failure modes that buys are both handled here rather than left to
   * callers:
   *
   * - **Every send failed.** The claim is released so the next sweep retries;
   *   otherwise one transient error would suppress that reminder forever.
   * - **Some sends failed.** The claim is kept — retrying would re-notify the
   *   recipients who already got it — and the shortfall is logged. Partial
   *   delivery still counts as sent.
   *
   * Recipients are deduped and delivered independently, so one member's
   * failure cannot silence another's; that matters for overdue tasks, where
   * the spec requires both the assignee and the assigner to hear about it.
   */
  private async claimAndNotify(params: {
    chapterId: string;
    entityType: DispatchEntityType;
    entityId: string;
    threshold: DispatchThreshold;
    dueDate: string;
    recipients: string[];
    title: string;
    body: string;
    category: string;
    target: Record<string, unknown>;
  }): Promise<boolean> {
    const claimed = await this.repository.claimDispatch(
      params.chapterId,
      params.entityType,
      params.entityId,
      params.threshold,
      params.dueDate,
    );
    if (!claimed) return false;

    const recipients = [...new Set(params.recipients)];
    let delivered = 0;

    for (const userId of recipients) {
      try {
        await this.notificationService.notifyUser(userId, params.chapterId, {
          title: params.title,
          body: params.body,
          category: params.category,
          data: { target: params.target },
        });
        delivered += 1;
      } catch (error) {
        this.logger.error(
          `${params.entityType} ${params.entityId} (${params.threshold}): delivery to ${userId} failed`,
          error as Error,
        );
      }
    }

    if (delivered === 0) {
      await this.repository.releaseDispatch(
        params.chapterId,
        params.entityType,
        params.entityId,
        params.threshold,
        params.dueDate,
      );
      return false;
    }

    if (delivered < recipients.length) {
      this.logger.warn(
        `${params.entityType} ${params.entityId} (${params.threshold}): delivered to ${delivered}/${recipients.length} recipients; not retrying`,
      );
    }
    return true;
  }
}
