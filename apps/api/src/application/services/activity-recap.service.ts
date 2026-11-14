import { Inject, Injectable, Logger } from '@nestjs/common';
import { isModuleEnabled } from '@repo/validation';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { TaskStatus } from '#domain/entities/task.entity';
import { LIST_QUERY_LIMIT_MAX } from '#domain/constants/list-query-limits';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import {
  defaultWeekStart,
  endedStudyMinutes,
} from './activity-standing.service';
import { EventService } from './event.service';
import type { EnabledModules } from './module-gate';
import { PointsService } from './points.service';
import { ServiceEntryService } from './service-entry.service';
import { StudyService } from './study.service';
import { TaskService } from './task.service';

/** The parts of the recap, as `unavailable` names them. */
export const RECAP_PARTS = [
  'events',
  'tasks',
  'points',
  'service',
  'study',
] as const;
export type RecapPart = (typeof RECAP_PARTS)[number];

/**
 * The member's last finished week (`spec/behavior/activity.md` § Recap): what
 * they did between `start` and `end`, each number through the module that
 * owns it. A part is `null` when its module is off, or when its read failed
 * (then it is also named in `unavailable`).
 */
export interface ActivityRecap {
  /** Where last week began: the client's last Sunday, or seven days before `end`. */
  start: string;
  /** Where it ended: the start of the client's current week. */
  end: string;
  /** Events the member was marked present or late at. Events off: `null`. */
  events_attended: number | null;
  /** Their own tasks they marked done that week. Tasks off: `null`. */
  tasks_done: number | null;
  /** Points awarded less points taken, from the ledger. Points off: `null`. */
  points: number | null;
  /** Service minutes logged for that week's days, not rejected. Hours off: `null`. */
  service_minutes: number | null;
  /** Minutes from study sessions that started that week and ended. Hours off: `null`. */
  study_minutes: number | null;
  unavailable: RecapPart[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** A week's ledger is read in pages of the list maximum, at most this many. */
const MAX_POINT_PAGES = 10;

/** How far the client's last-week start may sit from seven days before its week start. */
const LAST_WEEK_SLACK_MS = 3 * 60 * 60 * 1000;

/** A date as `YYYY-MM-DD`, read in UTC. */
const isoDay = (at: Date) => at.toISOString().slice(0, 10);

/**
 * The calendar day a local midnight falls on, when the client didn't say. The
 * server doesn't know the member's time zone; a midnight from UTC−12 to
 * UTC+12 lies within twelve hours of that day's UTC midnight, so the day is
 * the one nearest the instant. Further east the client's `first_day` is what
 * gets it right.
 */
function calendarDay(localMidnight: Date): string {
  return isoDay(new Date(localMidnight.getTime() + DAY_MS / 2));
}

/** `YYYY-MM-DD` plus `days`. */
function addDays(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/**
 * The recap's week from what the client sent. A week that crosses a clock
 * change is an hour longer or shorter than seven days, so the client's own
 * last Sunday is taken when it is near enough to seven days back; anything
 * further is not a week before this one, and the server's count stands. The
 * same for the first day, which a client east of UTC+12 knows better.
 */
export function recapWindow(
  end: Date,
  lastWeekStart: Date | undefined,
  firstDay: string | undefined,
): { start: Date; end: Date; firstDay: string } {
  const fixed = new Date(end.getTime() - WEEK_MS);
  const start =
    lastWeekStart &&
    !Number.isNaN(lastWeekStart.getTime()) &&
    Math.abs(lastWeekStart.getTime() - fixed.getTime()) <= LAST_WEEK_SLACK_MS
      ? lastWeekStart
      : fixed;
  const guessed = calendarDay(start);
  const day =
    firstDay &&
    !Number.isNaN(Date.parse(`${firstDay}T00:00:00Z`)) &&
    Math.abs(
      Date.parse(`${firstDay}T00:00:00Z`) - Date.parse(`${guessed}T00:00:00Z`),
    ) <= DAY_MS
      ? firstDay
      : guessed;
  return { start, end, firstDay: day };
}

/**
 * Activity's weekly recap (#4983): the member's last finished week, for the
 * card at the top of Activity at the start of the next one. A separate read
 * from `GET /v1/activity`, as the standing is, so the page's own read (on the
 * app's resume path, #3728) carries none of it.
 */
@Injectable()
export class ActivityRecapService {
  private readonly logger = new Logger(ActivityRecapService.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly eventService: EventService,
    private readonly pointsService: PointsService,
    private readonly serviceEntryService: ServiceEntryService,
    private readonly studyService: StudyService,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
  ) {}

  async getRecap(
    chapterId: string,
    userId: string,
    enabledModules: EnabledModules,
    options: {
      weekStart?: Date;
      lastWeekStart?: Date;
      firstDay?: string;
      now?: Date;
    } = {},
  ): Promise<ActivityRecap> {
    const now = options.now ?? new Date();
    const window = recapWindow(
      options.weekStart ?? defaultWeekStart(now),
      options.lastWeekStart,
      options.firstDay,
    );
    const { start, end } = window;
    const on = (moduleKey: string) =>
      isModuleEnabled(enabledModules, moduleKey);

    const unavailable: RecapPart[] = [];
    const part = async (
      id: RecapPart,
      moduleKey: string,
      read: () => Promise<number>,
    ): Promise<number | null> => {
      if (!on(moduleKey)) return null;
      try {
        return await read();
      } catch (error) {
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: `activity-recap:${id}`,
          message: `Activity recap '${id}' failed for chapter ${chapterId}`,
          error,
        });
        unavailable.push(id);
        return null;
      }
    };

    const [eventsAttended, tasksDone, points, serviceMinutes, studyMinutes] =
      await Promise.all([
        part('events', 'events', () =>
          this.readEvents(chapterId, userId, window),
        ),
        part('tasks', 'tasks', () => this.readTasks(chapterId, userId, window)),
        part('points', 'points', () =>
          this.readPoints(chapterId, userId, window),
        ),
        part('service', 'hours', () =>
          this.readService(chapterId, userId, window),
        ),
        part('study', 'hours', () => this.readStudy(chapterId, userId, window)),
      ]);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      events_attended: eventsAttended,
      tasks_done: tasksDone,
      points,
      service_minutes: serviceMinutes,
      study_minutes: studyMinutes,
      // In the order the parts are listed, whichever failed first.
      unavailable: RECAP_PARTS.filter((id) => unavailable.includes(id)),
    };
  }

  /** Events that started in the week, read as the member may see them, that they attended. */
  private async readEvents(
    chapterId: string,
    userId: string,
    { start, end }: Window,
  ): Promise<number> {
    const events = await this.eventService.findByChapter(chapterId, userId, {
      endsAfter: start.toISOString(),
      startsBefore: end.toISOString(),
    });
    const inWeek = events.filter((event) => {
      const at = new Date(event.start_time).getTime();
      return at >= start.getTime() && at < end.getTime();
    });
    if (inWeek.length === 0) return 0;
    const rows = await this.attendanceRepo.findByUserForEvents(
      userId,
      inWeek.map((event) => event.id),
    );
    return rows.filter(
      (row) => row.status === 'PRESENT' || row.status === 'LATE',
    ).length;
  }

  /**
   * Their own tasks marked done in the week, confirmed or not, as the week
   * ring counts them: done since the start less done since the end. One sent
   * back since is open again and not counted.
   */
  private async readTasks(
    chapterId: string,
    userId: string,
    { start, end }: Window,
  ): Promise<number> {
    const doneSince = (at: Date) =>
      this.taskService.count(chapterId, userId, false, {
        status: TaskStatus.COMPLETED,
        completedSince: at.toISOString(),
      });
    const [fromStart, fromEnd] = await Promise.all([
      doneSince(start),
      doneSince(end),
    ]);
    return Math.max(0, fromStart - fromEnd);
  }

  /** The week's ledger rows for the member, net, newest page first. */
  private async readPoints(
    chapterId: string,
    userId: string,
    { start, end }: Window,
  ): Promise<number> {
    let total = 0;
    let before = end.toISOString();
    for (let page = 0; page < MAX_POINT_PAGES; page += 1) {
      const rows = await this.pointsService.listTransactions(chapterId, {
        userId,
        before,
        limit: LIST_QUERY_LIMIT_MAX,
      });
      for (const row of rows) {
        if (new Date(row.created_at).getTime() >= start.getTime()) {
          total += row.amount;
        }
      }
      const last = rows.at(-1);
      if (
        !last ||
        rows.length < LIST_QUERY_LIMIT_MAX ||
        new Date(last.created_at).getTime() < start.getTime()
      ) {
        return total;
      }
      before = last.created_at;
    }
    // A week with more rows than this is no member's; what was read stands.
    return total;
  }

  /** Service the member logged for the week's seven days, approved or waiting. */
  private async readService(
    chapterId: string,
    userId: string,
    { firstDay }: Window,
  ): Promise<number> {
    const startDate = firstDay;
    const endDate = addDays(firstDay, 6);
    const entries = await this.serviceEntryService.findByChapterFiltered(
      chapterId,
      { userId, startDate, endDate },
    );
    return entries
      .filter(
        (entry) =>
          entry.user_id === userId &&
          (entry.status === 'APPROVED' || entry.status === 'PENDING'),
      )
      .reduce((sum, entry) => sum + entry.duration_minutes, 0);
  }

  /** Study sessions that started in the week and have ended, as the Study screen counts. */
  private async readStudy(
    chapterId: string,
    userId: string,
    { start, end }: Window,
  ): Promise<number> {
    const sessions = await this.studyService.listSessionsStartedSince(
      userId,
      chapterId,
      start,
    );
    return endedStudyMinutes(sessions, end);
  }
}

type Window = ReturnType<typeof recapWindow>;
