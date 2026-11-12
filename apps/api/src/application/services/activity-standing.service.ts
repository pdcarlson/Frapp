import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_CHECK_IN_OPENS_MINUTES,
  checkInWindowBounds,
  isModuleEnabled,
} from '@repo/validation';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Event } from '#domain/entities/event.entity';
import type { StudySessionStatus } from '#domain/entities/study.entity';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { EventService } from './event.service';
import { memberAttendance } from './event-role-targeting';
import type { EnabledModules } from './module-gate';
import { PointsService } from './points.service';
import { RbacService } from './rbac.service';
import { ServiceEntryService } from './service-entry.service';
import { StudyService } from './study.service';

/** The parts of the standing, as `unavailable` names them. */
export const STANDING_SECTIONS = [
  'points',
  'required_events',
  'service',
  'study',
] as const;
export type StandingSection = (typeof STANDING_SECTIONS)[number];

/** The member's points this semester and where that puts them. */
export interface StandingPoints {
  total: number;
  /**
   * Their place on the semester board, equal totals sharing a place (1, 1,
   * 3), as the leaderboard ranks. `null` when they are not on the board (an
   * alumnus with no points this semester).
   */
  rank: number | null;
  /** How many members the board ranks. */
  ranked: number;
}

/** Required events this semester, as the attendance sweep holds the member to them. */
export interface StandingRequiredEvents {
  /**
   * Required events that have happened since the semester began (or since
   * the member joined, if later), excused ones left out. An event counts once
   * its check-in has closed, or as soon as the member checked in to it.
   */
  required: number;
  /** Of those, the ones the member was marked present or late at. */
  attended: number;
  /** Required events they were excused from; not in `required`. */
  excused: number;
}

/** Service hours this semester, by the date the service was done. */
export interface StandingService {
  approved_minutes: number;
  pending_minutes: number;
}

/** Study time this week, counted as the Study screen counts it. */
export interface StandingStudy {
  minutes: number;
  /** The start of the week the minutes are counted from. */
  week_start: string;
}

export interface ActivityStanding {
  /** `null` when the chapter has Points off, or the read failed. */
  points: StandingPoints | null;
  /** `null` when the chapter has Events off, or the read failed. */
  required_events: StandingRequiredEvents | null;
  /** `null` when the chapter has Hours off, or the read failed. */
  service: StandingService | null;
  /** `null` when the chapter has Hours off, or the read failed. */
  study: StandingStudy | null;
  /** Parts that could not be read this time; each is served `null`. */
  unavailable: StandingSection[];
}

/** Study statuses a session cannot leave: its minutes are final. */
const ENDED_STUDY: ReadonlySet<StudySessionStatus> = new Set([
  'COMPLETED',
  'EXPIRED',
  'PAUSED_EXPIRED',
  'LOCATION_INVALID',
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start of the current week when a client names none: last Sunday at
 * midnight UTC, the Study screen's week (`startOfWeek`) read in UTC.
 */
export function defaultWeekStart(now: Date): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

/**
 * Whether a client's week start is one this read accepts: no later than now
 * plus a day (time zones run ahead of UTC by up to 14 hours) and no earlier
 * than eight days back, so it names this week and nothing wider.
 */
export function acceptableWeekStart(weekStart: Date, now: Date): boolean {
  const at = weekStart.getTime();
  return (
    !Number.isNaN(at) &&
    at <= now.getTime() + DAY_MS &&
    at >= now.getTime() - 8 * DAY_MS
  );
}

/**
 * Activity's standing (`spec/behavior/activity.md` § Standing): how the member
 * is doing this semester, read from the modules that own each number.
 *
 * Every number is the member's own and comes through the owning service: the
 * points ledger and its semester board (`PointsService`), their service
 * entries (`ServiceEntryService`, pinned to them), their study sessions
 * (`StudyService`), and the events that require them, under the rule the
 * absence sweep applies (`memberAttendance`). A module the chapter has off
 * contributes `null`, and so does one whose read fails, which is also named
 * in `unavailable`, so a client says "couldn't load" rather than drawing 0.
 */
@Injectable()
export class ActivityStandingService {
  private readonly logger = new Logger(ActivityStandingService.name);

  constructor(
    private readonly pointsService: PointsService,
    private readonly serviceEntryService: ServiceEntryService,
    private readonly studyService: StudyService,
    private readonly eventService: EventService,
    private readonly rbacService: RbacService,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
  ) {}

  async getStanding(
    chapterId: string,
    userId: string,
    enabledModules: EnabledModules,
    options: { weekStart?: Date; now?: Date } = {},
  ): Promise<ActivityStanding> {
    const now = options.now ?? new Date();
    const weekStart = options.weekStart ?? defaultWeekStart(now);
    const on = (moduleKey: string) =>
      isModuleEnabled(enabledModules, moduleKey);

    // One semester for every part, the one the points window uses. When it
    // can't be read, every part that depends on it fails rather than quietly
    // counting all-time.
    const since: Promise<Settled<Date | null>> = this.pointsService
      .getActiveSemesterSince(chapterId)
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => {
          reportCaughtFailure(this.logger, {
            level: 'error',
            site: 'activity-standing:semester',
            message: `Activity standing could not read the semester for chapter ${chapterId}`,
            error,
          });
          return { ok: false as const };
        },
      );
    const sinceOrThrow = async (): Promise<Date | null> => {
      const result = await since;
      if (!result.ok) throw new Error('Semester start could not be read');
      return result.value;
    };

    const [points, requiredEvents, service, study] = await Promise.all([
      on('points')
        ? this.settle('points', chapterId, () =>
            this.readPoints(chapterId, userId),
          )
        : OFF,
      on('events')
        ? this.settle('required_events', chapterId, async () =>
            this.readRequiredEvents(
              chapterId,
              userId,
              await sinceOrThrow(),
              now,
            ),
          )
        : OFF,
      on('hours')
        ? this.settle('service', chapterId, async () =>
            this.readService(chapterId, userId, await sinceOrThrow()),
          )
        : OFF,
      on('hours')
        ? this.settle('study', chapterId, () =>
            this.readStudy(chapterId, userId, weekStart),
          )
        : OFF,
    ]);

    const unavailable: StandingSection[] = [];
    const valueOf = <T>(
      section: StandingSection,
      result: Part<T>,
    ): T | null => {
      if (result === OFF_RESULT) return null;
      if (result.ok) return result.value;
      unavailable.push(section);
      return null;
    };

    return {
      points: valueOf('points', points),
      required_events: valueOf('required_events', requiredEvents),
      service: valueOf('service', service),
      study: valueOf('study', study),
      unavailable,
    };
  }

  private async readPoints(
    chapterId: string,
    userId: string,
  ): Promise<StandingPoints> {
    // The board already holds the member's semester total: every current
    // member is on it (at 0 with no points), and so is anyone who scored in
    // the window. Reading the total anywhere else would load their whole
    // ledger and could land on a different semester mid-rollover.
    const board = await this.pointsService.getLeaderboard(
      chapterId,
      'semester',
    );
    const index = board.findIndex((row) => row.user_id === userId);
    if (index < 0) return { total: 0, rank: null, ranked: board.length };
    // Equal totals share a place: the first row on this total is the rank.
    const total = board[index].total;
    const rank = board.findIndex((row) => row.total === total) + 1;
    return { total, rank, ranked: board.length };
  }

  private async readRequiredEvents(
    chapterId: string,
    userId: string,
    since: Date | null,
    now: Date,
  ): Promise<StandingRequiredEvents> {
    const [member, alumniRoleId] = await Promise.all([
      this.memberRepo.findByUserAndChapter(userId, chapterId),
      this.rbacService.getAlumniRoleId(chapterId),
    ]);
    if (!member) return { required: 0, attended: 0, excused: 0 };

    // Nothing from before they joined holds them, however the event reads.
    const joined = new Date(member.created_at);
    const from = [since, Number.isNaN(joined.getTime()) ? null : joined]
      .filter((date): date is Date => date !== null)
      .reduce<Date | null>(
        (latest, date) => (latest === null || date > latest ? date : latest),
        null,
      );

    // With the viewer, as Activity's Coming up reads them, so an event that
    // leaves the member out is never counted against them. The window reaches
    // as far ahead as check-in can open, so an event checked in to (or
    // excused) before it starts counts at once.
    const events = await this.eventService.findByChapter(chapterId, userId, {
      endsAfter: (from ?? new Date(0)).toISOString(),
      startsBefore: new Date(
        now.getTime() + MAX_CHECK_IN_OPENS_MINUTES * 60 * 1000,
      ).toISOString(),
    });
    const required = events.filter(
      (event) =>
        (from === null || new Date(event.start_time) > from) &&
        memberAttendance(event, member.role_ids, alumniRoleId) === 'required',
    );
    if (required.length === 0) return { required: 0, attended: 0, excused: 0 };

    const rows = await this.attendanceRepo.findByUserForEvents(
      userId,
      required.map((event) => event.id),
    );
    const statusOf = new Map(rows.map((row) => [row.event_id, row.status]));

    let counted = 0;
    let attended = 0;
    let excused = 0;
    for (const event of required) {
      const status = statusOf.get(event.id);
      const present = status === 'PRESENT' || status === 'LATE';
      if (status === 'EXCUSED') {
        excused += 1;
        continue;
      }
      // An event still open for check-in is not held against them yet; one
      // they already checked in to counts at once.
      if (!present && !checkInClosed(event, now)) continue;
      counted += 1;
      if (present) attended += 1;
    }
    return { required: counted, attended, excused };
  }

  private async readService(
    chapterId: string,
    userId: string,
    since: Date | null,
  ): Promise<StandingService> {
    // The archived semester owns its whole last day, so this semester's
    // service starts the day after (`spec/behavior/semester-rollover.md`).
    const startDate = since
      ? new Date(since.getTime() + 1).toISOString().slice(0, 10)
      : undefined;
    const entries = await this.serviceEntryService.findByChapterFiltered(
      chapterId,
      { userId, startDate },
    );
    let approved = 0;
    let pending = 0;
    for (const entry of entries) {
      if (entry.user_id !== userId) continue;
      if (entry.status === 'APPROVED') approved += entry.duration_minutes;
      else if (entry.status === 'PENDING') pending += entry.duration_minutes;
    }
    return { approved_minutes: approved, pending_minutes: pending };
  }

  private async readStudy(
    chapterId: string,
    userId: string,
    weekStart: Date,
  ): Promise<StandingStudy> {
    const sessions = await this.studyService.listSessionsStartedSince(
      userId,
      chapterId,
      weekStart,
    );
    const minutes = sessions
      .filter((session) => ENDED_STUDY.has(session.status))
      .reduce((sum, session) => sum + session.total_foreground_minutes, 0);
    return { minutes, week_start: weekStart.toISOString() };
  }

  /** Run one part; a failure is logged and reported, never thrown. */
  private async settle<T>(
    section: StandingSection,
    chapterId: string,
    read: () => Promise<T>,
  ): Promise<Settled<T>> {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: `activity-standing:${section.replace(/_/g, '-')}`,
        message: `Activity standing '${section}' failed for chapter ${chapterId}`,
        error,
      });
      return { ok: false };
    }
  }
}

type Settled<T> = { ok: true; value: T } | { ok: false };

/** A part whose module is off: neither a value nor a failure. */
const OFF_RESULT = Symbol('off');
const OFF: Promise<typeof OFF_RESULT> = Promise.resolve(OFF_RESULT);
type Part<T> = Settled<T> | typeof OFF_RESULT;

/** Whether the event's check-in has closed by `now` (its times unparseable: no). */
function checkInClosed(event: Event, now: Date): boolean {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }
  const { closesAt } = checkInWindowBounds(
    start,
    end,
    event.check_in_opens_minutes,
  );
  return closesAt.getTime() <= now.getTime();
}
