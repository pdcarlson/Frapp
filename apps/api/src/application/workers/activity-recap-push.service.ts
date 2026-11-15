import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { can } from '@repo/validation';
import { formatMinutesRounded } from '@repo/formatting';
import { ReportedCron } from './reported-cron.decorator';
import {
  CHAPTER_REPOSITORY,
  type ChapterRecapPushTarget,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import {
  ACTIVITY_RECAP_PUSH_REPOSITORY,
  type IActivityRecapPushRepository,
} from '#domain/repositories/activity-recap-push.repository.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ActivityRecapService,
  type ActivityRecap,
} from '../services/activity-recap.service';
import { NotificationService } from '../services/notification.service';
import { RbacService } from '../services/rbac.service';
import { DEFAULT_PUSH_TIME_ZONE } from '../services/push-copy';
import {
  localClock,
  localDateKey,
  localMidnight,
} from '../services/local-clock';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * The window, in the member's own zone, in which their weekly recap push goes
 * out: Sunday from 9 AM to noon, the first hourly tick in it. The same
 * morning window as the daily task reminders (#4788), on the first day of
 * the member's week, when Activity's "Last week" card starts showing.
 */
export const RECAP_PUSH_FROM_HOUR = 9;
export const RECAP_PUSH_UNTIL_HOUR = 12;

/**
 * The preference category the push is sent under: the "Weekly recap" switch
 * in notification settings (`NOTIFICATION_CATEGORIES` in `@repo/validation`).
 */
export const RECAP_NOTIFICATION_CATEGORY = 'recap';

/** The week a recap push sums up, in the member's own zone. */
export interface RecapPushWeek {
  /** Where the member's current week began: this Sunday's local midnight. */
  weekStart: Date;
  /** Where the recapped week began: last Sunday's local midnight. */
  lastWeekStart: Date;
  /** Last Sunday's date, `YYYY-MM-DD`: the push's once-a-week key. */
  firstDay: string;
}

/**
 * The week whose recap is due at `now` for a member in `timeZone`, or null
 * when it isn't Sunday morning there ({@link RECAP_PUSH_FROM_HOUR} to
 * {@link RECAP_PUSH_UNTIL_HOUR}). A member with no zone, or one this runtime
 * can't read, is placed in the zone their pushes fall back to.
 */
export function recapPushWeek(
  now: Date,
  timeZone: string | null,
): RecapPushWeek | null {
  let zone = timeZone ?? DEFAULT_PUSH_TIME_ZONE;
  let clock = localClock(now, zone);
  if (!clock) {
    zone = DEFAULT_PUSH_TIME_ZONE;
    clock = localClock(now, zone);
  }
  if (!clock) return null;
  const { year, month, day, hour } = clock;
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0) return null;
  if (hour < RECAP_PUSH_FROM_HOUR || hour >= RECAP_PUSH_UNTIL_HOUR) {
    return null;
  }
  const lastSunday = new Date(Date.UTC(year, month - 1, day - 7));
  return {
    weekStart: localMidnight(year, month, day, zone),
    lastWeekStart: localMidnight(year, month, day - 7, zone),
    firstDay: localDateKey({
      year: lastSunday.getUTCFullYear(),
      month: lastSunday.getUTCMonth() + 1,
      day: lastSunday.getUTCDate(),
    }),
  };
}

/**
 * Whether it is Sunday morning anywhere a member can be: from 9 AM Sunday at
 * UTC+14 (Saturday 19:00 UTC) to noon Sunday at UTC−12 (Monday 00:00 UTC).
 * Outside it a tick reads nothing.
 */
export function recapPushSeason(now: Date): boolean {
  const day = now.getUTCDay();
  return day === 0 || (day === 6 && now.getUTCHours() >= 19);
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/**
 * The push's line: the figures Activity's "Last week" card shows, in its
 * words (`activityRecapCard` in `@repo/hooks`), joined with " · ". A part
 * that is off, unread or zero is left out, as the card leaves it out; with
 * nothing left there is no push.
 */
export function recapPushBody(recap: ActivityRecap): string | null {
  const figures: string[] = [];
  const {
    events_attended: events,
    tasks_done: tasks,
    points,
    service_minutes: service,
    study_minutes: study,
  } = recap;
  if (events) figures.push(`${events} ${plural(events, 'event', 'events')}`);
  if (tasks) {
    figures.push(`${tasks} ${plural(tasks, 'task done', 'tasks done')}`);
  }
  if (points) {
    const label = plural(Math.abs(points), 'point', 'points');
    figures.push(`${points > 0 ? `+${points}` : points} ${label}`);
  }
  if (service) figures.push(`${formatMinutesRounded(service)} of service`);
  if (study) figures.push(`${formatMinutesRounded(study)} studied`);
  return figures.length > 0 ? figures.join(' · ') : null;
}

/**
 * The weekly recap push (#4985, `spec/behavior/activity.md` § Recap): on
 * Sunday morning in each member's own zone, last week's recap line, the
 * figures Activity's "Last week" card shows, for each chapter they're in.
 * Sent to the members who can read the recap (`members:view`, the route's
 * permission), under the `recap` category, so the "Weekly recap" switch in
 * notification settings turns it off. Nothing is sent for a week with
 * nothing to recap.
 *
 * Runs hourly on every API replica, as the daily reminders do (#4788).
 * Before reading a member's recap, a sweep claims their week for the chapter
 * (`activity_recap_pushes`, keyed by chapter, member and the week's first
 * day): only the claim that lands sends, so a member hears once however many
 * replicas tick. A recap that couldn't be read whole, or a push that failed,
 * gives its claim back, so the next tick in the window tries again; an empty
 * week keeps it, so it isn't read again each hour. Ticks on one replica don't
 * overlap. A canceled chapter sends none.
 */
@Injectable()
export class ActivityRecapPushService {
  private readonly logger = new Logger(ActivityRecapPushService.name);
  private running = false;

  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(ACTIVITY_RECAP_PUSH_REPOSITORY)
    private readonly claims: IActivityRecapPushRepository,
    private readonly rbac: RbacService,
    private readonly recapService: ActivityRecapService,
    private readonly notificationService: NotificationService,
  ) {}

  @ReportedCron(CronExpression.EVERY_HOUR)
  async handleRecapPushes(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } finally {
      this.running = false;
    }
  }

  /** One pass over every chapter. Returns how many pushes went out. */
  async sweep(now: Date): Promise<number> {
    if (!recapPushSeason(now)) return 0;
    const chapters = await this.chapterRepo.findForRecapPush();
    let sent = 0;
    for (const chapter of chapters) {
      try {
        sent += await this.sweepChapter(chapter, now);
      } catch (error) {
        // One chapter's failure doesn't hold back the rest; its members are
        // tried again next tick.
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'activity-recap-push',
          message: `recap pushes failed for chapter ${chapter.id}; tried again next tick`,
          error,
        });
      }
    }
    return sent;
  }

  private async sweepChapter(
    chapter: ChapterRecapPushTarget,
    now: Date,
  ): Promise<number> {
    const access = await this.rbac.getChapterMemberAccess(chapter.id);
    const readers = access
      .filter((member) =>
        can(SystemPermissions.MEMBERS_VIEW, [...member.permissions]),
      )
      .map((member) => member.user_id);
    if (readers.length === 0) return 0;
    // The zone a push to the member would use (`recipientTimeZone`).
    const zones = await this.notificationService.timeZonesFor(readers);
    let sent = 0;
    for (const userId of readers) {
      const week = recapPushWeek(now, zones.get(userId) ?? null);
      if (!week) continue;
      if (!(await this.claims.claim(chapter.id, userId, week.firstDay))) {
        continue;
      }
      try {
        if (await this.sendRecap(chapter, userId, week, now)) sent += 1;
      } catch (error) {
        await this.claims
          .release(chapter.id, userId, week.firstDay)
          .catch(() => undefined);
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'activity-recap-push',
          message: `recap push failed for a member of chapter ${chapter.id}; tried again next tick`,
          error,
        });
      }
    }
    return sent;
  }

  /**
   * Reads the member's recap and sends it. False for a week with nothing to
   * recap; throws for one that couldn't be read whole, so the caller gives
   * the claim back.
   */
  private async sendRecap(
    chapter: ChapterRecapPushTarget,
    userId: string,
    week: RecapPushWeek,
    now: Date,
  ): Promise<boolean> {
    const recap = await this.recapService.getRecap(
      chapter.id,
      userId,
      chapter.enabled_modules,
      {
        weekStart: week.weekStart,
        lastWeekStart: week.lastWeekStart,
        firstDay: week.firstDay,
        now,
      },
    );
    if (recap.unavailable.length > 0) {
      throw new Error(
        `recap parts unavailable: ${recap.unavailable.join(', ')}`,
      );
    }
    const body = recapPushBody(recap);
    if (!body) return false;
    await this.notificationService.notifyUser(userId, chapter.id, {
      title: `Last week in ${chapter.name}`,
      body,
      category: RECAP_NOTIFICATION_CATEGORY,
      data: { target: { screen: 'activity' } },
    });
    return true;
  }
}
