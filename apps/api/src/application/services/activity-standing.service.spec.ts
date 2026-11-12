import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import {
  ActivityStandingService,
  acceptableWeekStart,
  defaultWeekStart,
} from './activity-standing.service';
import type { Event } from '#domain/entities/event.entity';
import type { EventAttendance } from '#domain/entities/event-attendance.entity';
import type { ServiceEntry } from '#domain/entities/service-entry.entity';
import type { StudySession } from '#domain/entities/study.entity';

const CHAPTER = 'chapter-1';
const ME = 'user-me';
const OTHER = 'user-other';
const BROTHER_ROLE = 'role-brother';
const PLEDGE_ROLE = 'role-pledge';
const ALUMNI_ROLE = 'role-alumni';

// A Thursday evening.
const NOW = new Date('2026-11-12T20:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) =>
  new Date(NOW.getTime() + offsetMs).toISOString();
// The latest archive ended 1 Sep, so the semester is everything after it.
const SEMESTER_SINCE = new Date('2026-09-01T23:59:59.999Z');
// The events read reaches as far ahead as check-in can open (two hours).
const READ_UNTIL = at(2 * HOUR);

const event = (overrides: Partial<Event>): Event =>
  ({
    id: 'event-1',
    chapter_id: CHAPTER,
    name: 'Chapter meeting',
    location: null,
    start_time: at(-7 * DAY),
    end_time: at(-7 * DAY + HOUR),
    point_value: 10,
    is_mandatory: true,
    required_role_ids: null,
    optional_role_ids: null,
    excluded_role_ids: null,
    others_invited: null,
    check_in_opens_minutes: 10,
    parent_event_id: null,
    created_by: null,
    created_at: at(-30 * DAY),
    ...overrides,
  }) as Event;

const attendance = (
  eventId: string,
  status: EventAttendance['status'],
): EventAttendance => ({
  id: `att-${eventId}`,
  event_id: eventId,
  user_id: ME,
  status,
  check_in_time: null,
  excuse_reason: null,
  marked_by: null,
  created_at: at(-DAY),
});

const entry = (overrides: Partial<ServiceEntry>): ServiceEntry =>
  ({
    id: 'entry-1',
    chapter_id: CHAPTER,
    user_id: ME,
    date: '2026-10-01',
    duration_minutes: 60,
    description: 'Food bank',
    status: 'APPROVED',
    ...overrides,
  }) as ServiceEntry;

const session = (overrides: Partial<StudySession>): StudySession =>
  ({
    id: 'session-1',
    chapter_id: CHAPTER,
    user_id: ME,
    geofence_id: 'zone-1',
    status: 'COMPLETED',
    start_time: at(-DAY),
    end_time: at(-DAY + HOUR),
    total_foreground_minutes: 60,
    ...overrides,
  }) as StudySession;

function build(
  options: {
    roleIds?: string[];
    joinedAt?: string;
    board?: { user_id: string; total: number }[];
    events?: Event[];
    rows?: EventAttendance[];
    entries?: ServiceEntry[];
    sessions?: StudySession[];
    since?: Date | null;
  } = {},
) {
  const pointsService = {
    getActiveSemesterSince: jest
      .fn()
      .mockResolvedValue(
        options.since === undefined ? SEMESTER_SINCE : options.since,
      ),
    getLeaderboard: jest.fn().mockResolvedValue(options.board ?? []),
  };
  const serviceEntryService = {
    findByChapterFiltered: jest.fn().mockResolvedValue(options.entries ?? []),
  };
  const studyService = {
    listSessionsStartedSince: jest
      .fn()
      .mockResolvedValue(options.sessions ?? []),
  };
  const eventService = {
    findByChapter: jest.fn().mockResolvedValue(options.events ?? []),
  };
  const rbacService = {
    getAlumniRoleId: jest.fn().mockResolvedValue(ALUMNI_ROLE),
  };
  const memberRepo = {
    findByUserAndChapter: jest.fn().mockResolvedValue({
      user_id: ME,
      chapter_id: CHAPTER,
      role_ids: options.roleIds ?? [BROTHER_ROLE],
      created_at: options.joinedAt ?? '2026-01-01T00:00:00.000Z',
    }),
  };
  const attendanceRepo = {
    findByUserForEvents: jest.fn().mockResolvedValue(options.rows ?? []),
  };
  const service = new ActivityStandingService(
    pointsService as never,
    serviceEntryService as never,
    studyService as never,
    eventService as never,
    rbacService as never,
    memberRepo as never,
    attendanceRepo as never,
  );
  return {
    service,
    pointsService,
    serviceEntryService,
    studyService,
    eventService,
    attendanceRepo,
  };
}

const read = (
  service: ActivityStandingService,
  modules: Record<string, boolean> | null = null,
  weekStart?: Date,
) => service.getStanding(CHAPTER, ME, modules, { now: NOW, weekStart });

describe('ActivityStandingService', () => {
  let reportSpy: jest.SpyInstance;
  beforeEach(() => {
    reportSpy = jest
      .spyOn(caughtFailure, 'reportCaughtFailure')
      .mockImplementation(() => undefined);
  });
  afterEach(() => reportSpy.mockRestore());

  describe('points', () => {
    it('serves the semester total and the place on the semester board', async () => {
      const { service, pointsService } = build({
        board: [
          { user_id: OTHER, total: 60 },
          { user_id: ME, total: 42 },
          { user_id: 'user-3', total: 10 },
        ],
      });
      const standing = await read(service);
      expect(standing.points).toEqual({ total: 42, rank: 2, ranked: 3 });
      expect(pointsService.getLeaderboard).toHaveBeenCalledWith(
        CHAPTER,
        'semester',
      );
    });

    it('shares a place on equal totals, as the leaderboard does', async () => {
      const { service } = build({
        board: [
          { user_id: OTHER, total: 0 },
          { user_id: 'user-3', total: 0 },
          { user_id: ME, total: 0 },
        ],
      });
      expect((await read(service)).points?.rank).toBe(1);
    });

    it('has no place when the member is not on the board', async () => {
      const { service } = build({ board: [{ user_id: OTHER, total: 5 }] });
      expect((await read(service)).points).toEqual({
        total: 0,
        rank: null,
        ranked: 1,
      });
    });
  });

  describe('required events', () => {
    it('counts past required events and the ones attended, leaving excused out', async () => {
      const { service, attendanceRepo } = build({
        events: [
          event({ id: 'present' }),
          event({ id: 'late' }),
          event({ id: 'absent' }),
          event({ id: 'no-row' }),
          event({ id: 'excused' }),
        ],
        rows: [
          attendance('present', 'PRESENT'),
          attendance('late', 'LATE'),
          attendance('absent', 'ABSENT'),
          attendance('excused', 'EXCUSED'),
        ],
      });
      expect((await read(service)).required_events).toEqual({
        required: 4,
        attended: 2,
        excused: 1,
      });
      expect(attendanceRepo.findByUserForEvents).toHaveBeenCalledWith(ME, [
        'present',
        'late',
        'absent',
        'no-row',
        'excused',
      ]);
    });

    it('leaves out optional events and ones a role excuses the member from', async () => {
      const { service } = build({
        roleIds: [BROTHER_ROLE],
        events: [
          event({ id: 'optional', is_mandatory: false }),
          event({
            id: 'pledges-only',
            required_role_ids: [PLEDGE_ROLE],
            optional_role_ids: [BROTHER_ROLE],
            others_invited: false,
          }),
          event({ id: 'required' }),
        ],
      });
      expect((await read(service)).required_events).toEqual({
        required: 1,
        attended: 0,
        excused: 0,
      });
    });

    it('holds an alumnus only to events that name an alumni role', async () => {
      const { service } = build({
        roleIds: [ALUMNI_ROLE],
        events: [event({ id: 'default-required' })],
      });
      expect((await read(service)).required_events?.required).toBe(0);
    });

    it('does not count an event whose check-in is still open, unless the member checked in', async () => {
      const tonight = {
        start_time: at(-HOUR),
        end_time: at(HOUR),
      };
      const { service } = build({
        events: [
          event({ id: 'open-not-in', ...tonight }),
          event({ id: 'open-checked-in', ...tonight }),
        ],
        rows: [attendance('open-checked-in', 'PRESENT')],
      });
      expect((await read(service)).required_events).toEqual({
        required: 1,
        attended: 1,
        excused: 0,
      });
    });

    it('counts a check-in or an excusal made before the event starts', async () => {
      // Check-in opens up to two hours early; the read reaches that far ahead.
      const soon = {
        start_time: at(HOUR),
        end_time: at(2 * HOUR),
        check_in_opens_minutes: 120,
      };
      const { service } = build({
        events: [
          event({ id: 'early-in', ...soon }),
          event({ id: 'excused-ahead', ...soon }),
          event({ id: 'not-yet', ...soon }),
        ],
        rows: [
          attendance('early-in', 'PRESENT'),
          attendance('excused-ahead', 'EXCUSED'),
        ],
      });
      expect((await read(service)).required_events).toEqual({
        required: 1,
        attended: 1,
        excused: 1,
      });
    });

    it('reads from the semester start when the member joined before it', async () => {
      const { service, eventService } = build({
        joinedAt: '2026-01-15T00:00:00.000Z',
        events: [
          // Last spring's meeting: after they joined, before this semester.
          event({
            id: 'last-semester',
            start_time: '2026-04-01T18:00:00.000Z',
          }),
          event({ id: 'this-semester' }),
        ],
      });
      expect((await read(service)).required_events?.required).toBe(1);
      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
        endsAfter: SEMESTER_SINCE.toISOString(),
        startsBefore: READ_UNTIL,
      });
    });

    it('reads from the semester start, and leaves out events before the member joined', async () => {
      const joinedAt = at(-10 * DAY);
      const { service, eventService } = build({
        joinedAt,
        events: [
          event({ id: 'before-joining', start_time: at(-20 * DAY) }),
          event({ id: 'after-joining' }),
        ],
      });
      expect((await read(service)).required_events?.required).toBe(1);
      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
        endsAfter: joinedAt,
        startsBefore: READ_UNTIL,
      });
    });

    it('reads every event so far when the chapter has never rolled over', async () => {
      const { service, eventService } = build({
        since: null,
        joinedAt: 'not a date',
      });
      await read(service);
      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
        endsAfter: new Date(0).toISOString(),
        startsBefore: READ_UNTIL,
      });
    });
  });

  describe('service hours', () => {
    it('sums approved and pending minutes from the day after the archive', async () => {
      const { service, serviceEntryService } = build({
        entries: [
          entry({ id: 'a', duration_minutes: 90 }),
          entry({ id: 'b', duration_minutes: 30 }),
          entry({ id: 'p', status: 'PENDING', duration_minutes: 45 }),
          entry({ id: 'r', status: 'REJECTED', duration_minutes: 600 }),
          // Never someone else's, whatever the read returns.
          entry({ id: 'x', user_id: OTHER, duration_minutes: 600 }),
        ],
      });
      expect((await read(service)).service).toEqual({
        approved_minutes: 120,
        pending_minutes: 45,
      });
      expect(serviceEntryService.findByChapterFiltered).toHaveBeenCalledWith(
        CHAPTER,
        { userId: ME, startDate: '2026-09-02' },
      );
    });
  });

  describe('study', () => {
    it("sums ended sessions that started in the client's week", async () => {
      const weekStart = new Date('2026-11-08T05:00:00.000Z');
      const { service, studyService } = build({
        sessions: [
          session({ id: 'in-week', total_foreground_minutes: 50 }),
          session({
            id: 'expired',
            status: 'EXPIRED',
            total_foreground_minutes: 20,
          }),
          session({
            id: 'running',
            status: 'ACTIVE',
            total_foreground_minutes: 30,
          }),
        ],
      });
      expect((await read(service, null, weekStart)).study).toEqual({
        minutes: 70,
        week_start: weekStart.toISOString(),
      });
      // The week bound is the query's, and the read is the one that settles
      // nothing (so a hot read never writes).
      expect(studyService.listSessionsStartedSince).toHaveBeenCalledWith(
        ME,
        CHAPTER,
        weekStart,
      );
    });

    it('defaults the week to last Sunday at midnight UTC', () => {
      expect(defaultWeekStart(NOW).toISOString()).toBe(
        '2026-11-08T00:00:00.000Z',
      );
    });

    it('accepts a week start within the last eight days only', () => {
      expect(acceptableWeekStart(new Date(at(-3 * DAY)), NOW)).toBe(true);
      expect(acceptableWeekStart(new Date(at(10 * HOUR)), NOW)).toBe(true);
      expect(acceptableWeekStart(new Date(at(-9 * DAY)), NOW)).toBe(false);
      expect(acceptableWeekStart(new Date(at(2 * DAY)), NOW)).toBe(false);
    });
  });

  describe('modules and failures', () => {
    it('serves null for a module the chapter has off, and reads nothing for it', async () => {
      const { service, pointsService, eventService, studyService } = build();
      const standing = await read(service, {
        points: false,
        events: false,
        hours: false,
      });
      expect(standing).toMatchObject({
        points: null,
        required_events: null,
        service: null,
        study: null,
        unavailable: [],
      });
      expect(pointsService.getLeaderboard).not.toHaveBeenCalled();
      expect(eventService.findByChapter).not.toHaveBeenCalled();
      expect(studyService.listSessionsStartedSince).not.toHaveBeenCalled();
    });

    it('names a part that fails and serves the others', async () => {
      const { service, studyService } = build({
        board: [{ user_id: ME, total: 5 }],
      });
      studyService.listSessionsStartedSince.mockRejectedValue(
        new Error('boom'),
      );
      const standing = await read(service);
      expect(standing.study).toBeNull();
      expect(standing.unavailable).toEqual(['study']);
      expect(standing.points?.total).toBe(5);
      expect(reportSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ site: 'activity-standing:study' }),
      );
    });

    it('fails the semester parts, rather than counting all-time, when the semester read fails', async () => {
      const { service, pointsService } = build();
      pointsService.getActiveSemesterSince.mockRejectedValue(new Error('db'));
      const standing = await read(service);
      expect(standing.required_events).toBeNull();
      expect(standing.service).toBeNull();
      expect(standing.unavailable).toEqual(['required_events', 'service']);
      expect(standing.study).not.toBeNull();
    });
  });
});
