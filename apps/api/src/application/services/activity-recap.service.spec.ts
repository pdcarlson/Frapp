import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import { ActivityRecapService } from './activity-recap.service';
import { TaskStatus } from '#domain/entities/task.entity';
import type { Event } from '#domain/entities/event.entity';
import type { EventAttendance } from '#domain/entities/event-attendance.entity';
import type { PointTransaction } from '#domain/entities/point-transaction.entity';
import type { ServiceEntry } from '#domain/entities/service-entry.entity';
import type { StudySession } from '#domain/entities/study.entity';

const CHAPTER = 'chapter-1';
const ME = 'user-me';
// This week began Sunday 15 Nov 2026 at midnight in New York.
const THIS_WEEK = new Date('2026-11-15T05:00:00.000Z');
const LAST_WEEK = new Date('2026-11-08T05:00:00.000Z');
const NOW = new Date('2026-11-16T15:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const after = (base: Date, ms: number) =>
  new Date(base.getTime() + ms).toISOString();

const event = (id: string, start: string): Event =>
  ({
    id,
    chapter_id: CHAPTER,
    start_time: start,
    end_time: after(new Date(start), HOUR),
  }) as Event;

const attended = (
  eventId: string,
  status: EventAttendance['status'],
): EventAttendance =>
  ({ event_id: eventId, user_id: ME, status }) as EventAttendance;

const txn = (amount: number, createdAt: string): PointTransaction =>
  ({ id: createdAt, amount, created_at: createdAt }) as PointTransaction;

const entry = (overrides: Partial<ServiceEntry>): ServiceEntry =>
  ({
    user_id: ME,
    date: '2026-11-10',
    duration_minutes: 60,
    status: 'APPROVED',
    ...overrides,
  }) as ServiceEntry;

const session = (overrides: Partial<StudySession>): StudySession =>
  ({
    status: 'COMPLETED',
    start_time: after(LAST_WEEK, 30 * HOUR),
    total_foreground_minutes: 45,
    ...overrides,
  }) as StudySession;

describe('ActivityRecapService', () => {
  const taskService = { count: jest.fn() };
  const eventService = { findByChapter: jest.fn() };
  const pointsService = { listTransactions: jest.fn() };
  const serviceEntryService = { findByChapterFiltered: jest.fn() };
  const studyService = { listSessionsStartedSince: jest.fn() };
  const attendanceRepo = { findByUserForEvents: jest.fn() };
  let service: ActivityRecapService;
  let report: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    report = jest
      .spyOn(caughtFailure, 'reportCaughtFailure')
      .mockImplementation(() => undefined);
    service = new ActivityRecapService(
      taskService as never,
      eventService as never,
      pointsService as never,
      serviceEntryService as never,
      studyService as never,
      attendanceRepo as never,
    );
    taskService.count.mockResolvedValue(0);
    eventService.findByChapter.mockResolvedValue([]);
    attendanceRepo.findByUserForEvents.mockResolvedValue([]);
    pointsService.listTransactions.mockResolvedValue([]);
    serviceEntryService.findByChapterFiltered.mockResolvedValue([]);
    studyService.listSessionsStartedSince.mockResolvedValue([]);
  });

  afterEach(() => report.mockRestore());

  const read = (enabledModules: Record<string, boolean> | null = null) =>
    service.getRecap(CHAPTER, ME, enabledModules, {
      weekStart: THIS_WEEK,
      now: NOW,
    });

  it('reads the seven days before the week the client named', async () => {
    const recap = await read();
    expect(recap.start).toBe(LAST_WEEK.toISOString());
    expect(recap.end).toBe(THIS_WEEK.toISOString());
    expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
      endsAfter: LAST_WEEK.toISOString(),
      startsBefore: THIS_WEEK.toISOString(),
    });
    // Sunday 8 Nov to Saturday 14 Nov, the member's days.
    expect(serviceEntryService.findByChapterFiltered).toHaveBeenCalledWith(
      CHAPTER,
      { userId: ME, startDate: '2026-11-08', endDate: '2026-11-14' },
    );
  });

  it('counts only events that started last week and were attended', async () => {
    eventService.findByChapter.mockResolvedValue([
      event('present', after(LAST_WEEK, 24 * HOUR)),
      event('late', after(LAST_WEEK, 48 * HOUR)),
      event('absent', after(LAST_WEEK, 72 * HOUR)),
      // Began the week before and ran into last week: not last week's.
      event('earlier', after(LAST_WEEK, -HOUR)),
    ]);
    attendanceRepo.findByUserForEvents.mockResolvedValue([
      attended('present', 'PRESENT'),
      attended('late', 'LATE'),
      attended('absent', 'ABSENT'),
    ]);

    const recap = await read();

    expect(attendanceRepo.findByUserForEvents).toHaveBeenCalledWith(ME, [
      'present',
      'late',
      'absent',
    ]);
    expect(recap.events_attended).toBe(2);
  });

  it('counts tasks done in the week as done since its start less done since its end', async () => {
    taskService.count.mockImplementation(
      (
        _c: string,
        _u: string,
        isAdmin: boolean,
        options: { completedSince: string },
      ) => {
        // Always the member's own tasks, never the chapter's.
        expect(isAdmin).toBe(false);
        return Promise.resolve(
          options.completedSince === LAST_WEEK.toISOString() ? 7 : 2,
        );
      },
    );

    const recap = await read();

    expect(taskService.count).toHaveBeenCalledWith(CHAPTER, ME, false, {
      status: TaskStatus.COMPLETED,
      completedSince: THIS_WEEK.toISOString(),
    });
    expect(recap.tasks_done).toBe(5);
  });

  it('sums the week’s ledger net, paging back until it passes the start', async () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      txn(1, after(THIS_WEEK, -(index + 1) * 60 * 1000)),
    );
    pointsService.listTransactions
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([
        txn(-5, after(LAST_WEEK, 2 * HOUR)),
        // From the week before: left out, and the paging stops.
        txn(50, after(LAST_WEEK, -HOUR)),
      ]);

    const recap = await read();

    expect(pointsService.listTransactions).toHaveBeenNthCalledWith(1, CHAPTER, {
      userId: ME,
      before: THIS_WEEK.toISOString(),
      limit: 200,
    });
    expect(pointsService.listTransactions).toHaveBeenNthCalledWith(2, CHAPTER, {
      userId: ME,
      before: full[199].created_at,
      limit: 200,
    });
    expect(recap.points).toBe(195);
  });

  it('counts service approved or waiting, never rejected', async () => {
    serviceEntryService.findByChapterFiltered.mockResolvedValue([
      entry({ duration_minutes: 60 }),
      entry({ duration_minutes: 30, status: 'PENDING' }),
      entry({ duration_minutes: 90, status: 'REJECTED' }),
    ]);
    expect((await read()).service_minutes).toBe(90);
  });

  it('counts study that started last week and has ended', async () => {
    studyService.listSessionsStartedSince.mockResolvedValue([
      session({}),
      session({ status: 'ACTIVE', total_foreground_minutes: 20 }),
      // This week's: started after last week ended.
      session({ start_time: after(THIS_WEEK, HOUR) }),
    ]);

    const recap = await read();

    expect(studyService.listSessionsStartedSince).toHaveBeenCalledWith(
      ME,
      CHAPTER,
      LAST_WEEK,
    );
    expect(recap.study_minutes).toBe(45);
  });

  it('serves null for a module that is off, without reading it', async () => {
    const recap = await read({
      events: false,
      tasks: false,
      points: false,
      hours: false,
    });

    expect(recap).toMatchObject({
      events_attended: null,
      tasks_done: null,
      points: null,
      service_minutes: null,
      study_minutes: null,
      unavailable: [],
    });
    expect(eventService.findByChapter).not.toHaveBeenCalled();
    expect(taskService.count).not.toHaveBeenCalled();
    expect(pointsService.listTransactions).not.toHaveBeenCalled();
    expect(serviceEntryService.findByChapterFiltered).not.toHaveBeenCalled();
  });

  it('names a part that failed, serves it null and keeps the rest', async () => {
    pointsService.listTransactions.mockRejectedValue(new Error('down'));
    taskService.count.mockResolvedValue(3);

    const recap = await read();

    expect(recap.points).toBeNull();
    expect(recap.unavailable).toEqual(['points']);
    expect(recap.tasks_done).toBe(0);
    expect(report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ site: 'activity-recap:points' }),
    );
  });
});
