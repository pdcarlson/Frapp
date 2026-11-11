import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AttendanceService } from '../services/attendance.service';
import { NotificationService } from '../services/notification.service';
import { ChapterWorkflowsService } from '../services/chapter-workflows.service';
import { ReportRetentionService } from '../services/report-retention.service';
import { PollService } from '../services/poll.service';
import { ChatReportService } from '../services/chat-report.service';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { SCHEDULED_JOBS_REPOSITORY } from '#domain/repositories/scheduled-jobs.repository.interface';
import { SIGNET_ENGINE_VERSION } from '@repo/chapter-theme';
import { buildChapterPalette } from '../services/chapter-palette';

// The beta list, controllable per test: the sweep's own rules are pinned with
// dues on, and the beta's case (dues off, nothing sent) sets `mockBetaOff.keys`.
const mockBetaOff: { keys: string[] } = { keys: [] };
jest.mock('@repo/validation', () => ({
  ...jest.requireActual<typeof import('@repo/validation')>('@repo/validation'),
  isBetaOffModule: (key: string) => mockBetaOff.keys.includes(key),
}));

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);
const captureMessage = jest.mocked(Sentry.captureMessage);

/**
 * Fixed clock for every sweep. The sweeps take `now` as a parameter precisely
 * so these tests never depend on the wall clock — a suite that passed only in
 * some hours of the day would be worse than no suite.
 */
const NOW = new Date('2026-08-05T12:00:00Z');
const TODAY = '2026-08-05';
const TOMORROW = '2026-08-06';

describe('ScheduledJobsService', () => {
  let service: ScheduledJobsService;
  let markAutoAbsent: jest.Mock;
  let notifyUser: jest.Mock;
  let getDuesGraceDays: jest.Mock;
  let claimDispatch: jest.Mock;
  let releaseDispatch: jest.Mock;
  let findByUserAndChapter: jest.Mock;
  let findEventsPendingAutoAbsent: jest.Mock;
  let findOpenInvoicesDueBetween: jest.Mock;
  let findIncompleteTasksDueBetween: jest.Mock;
  let sweepExpiredReports: jest.Mock;
  let findExpiredPollsPendingNotice: jest.Mock;
  let announceExpiry: jest.Mock;
  let findEventsStartingBetween: jest.Mock;
  let resolveRequiredMembers: jest.Mock;
  let findChaptersWithStalePalette: jest.Mock;
  let writeRecomputedPalette: jest.Mock;
  let sweepPendingEvidenceReleases: jest.Mock;

  const INVOICE = {
    id: 'inv-1',
    chapter_id: 'chap-1',
    user_id: 'user-1',
    title: 'Fall Dues',
    amount: 25_000,
    due_date: TOMORROW,
  };

  const TASK = {
    id: 'task-1',
    chapter_id: 'chap-1',
    assignee_id: 'user-1',
    created_by: 'admin-1',
    title: 'Book the venue',
    due_date: TOMORROW,
  };

  beforeEach(async () => {
    captureException.mockClear();
    captureMessage.mockClear();
    markAutoAbsent = jest.fn().mockResolvedValue({ marked: 0 });
    notifyUser = jest.fn().mockResolvedValue(undefined);
    getDuesGraceDays = jest.fn().mockResolvedValue(0);
    // Default: the claim succeeds, i.e. this is the first sweep to see it.
    claimDispatch = jest.fn().mockResolvedValue(true);
    releaseDispatch = jest.fn().mockResolvedValue(undefined);
    // Default: the assigner is still a member of the chapter.
    findByUserAndChapter = jest.fn().mockResolvedValue({ id: 'mem-1' });
    findEventsPendingAutoAbsent = jest.fn().mockResolvedValue([]);
    findOpenInvoicesDueBetween = jest.fn().mockResolvedValue([]);
    findIncompleteTasksDueBetween = jest.fn().mockResolvedValue([]);
    sweepExpiredReports = jest
      .fn()
      .mockResolvedValue({ deleted: 0, failed: 0 });
    findExpiredPollsPendingNotice = jest.fn().mockResolvedValue([]);
    announceExpiry = jest.fn().mockResolvedValue(undefined);
    findEventsStartingBetween = jest.fn().mockResolvedValue([]);
    // Default: one member is required at the event.
    resolveRequiredMembers = jest
      .fn()
      .mockResolvedValue([{ user_id: 'user-1', role_ids: [] }]);
    findChaptersWithStalePalette = jest.fn().mockResolvedValue([]);
    // Default: the compare-and-set write lands.
    writeRecomputedPalette = jest.fn().mockResolvedValue(true);
    sweepPendingEvidenceReleases = jest.fn().mockResolvedValue(0);

    const mod = await Test.createTestingModule({
      providers: [
        ScheduledJobsService,
        {
          provide: SCHEDULED_JOBS_REPOSITORY,
          useValue: {
            findEventsPendingAutoAbsent,
            findOpenInvoicesDueBetween,
            findIncompleteTasksDueBetween,
            findExpiredPollsPendingNotice,
            findEventsStartingBetween,
            claimDispatch,
            releaseDispatch,
            findChaptersWithStalePalette,
            writeRecomputedPalette,
          },
        },
        {
          provide: AttendanceService,
          useValue: { markAutoAbsent, resolveRequiredMembers },
        },
        { provide: NotificationService, useValue: { notifyUser } },
        { provide: ChapterWorkflowsService, useValue: { getDuesGraceDays } },
        { provide: ReportRetentionService, useValue: { sweepExpiredReports } },
        { provide: PollService, useValue: { announceExpiry } },
        { provide: MEMBER_REPOSITORY, useValue: { findByUserAndChapter } },
        {
          provide: ChatReportService,
          useValue: { sweepPendingEvidenceReleases },
        },
      ],
    }).compile();

    service = mod.get(ScheduledJobsService);
  });

  describe('sweepAutoAbsent', () => {
    it('marks auto-absent for every event whose grace period has closed', async () => {
      findEventsPendingAutoAbsent.mockResolvedValue([
        { id: 'evt-1', chapter_id: 'chap-1', end_time: '2026-08-05T10:00:00Z' },
        { id: 'evt-2', chapter_id: 'chap-2', end_time: '2026-08-05T11:00:00Z' },
      ]);

      const result = await service.sweepAutoAbsent(NOW);

      expect(result).toEqual({ events: 2 });
      expect(markAutoAbsent).toHaveBeenCalledWith('evt-1', 'chap-1');
      expect(markAutoAbsent).toHaveBeenCalledWith('evt-2', 'chap-2');
    });

    it('queries only events whose 15-minute grace has already elapsed', async () => {
      await service.sweepAutoAbsent(NOW);

      const [endedAfter, endedBefore] =
        findEventsPendingAutoAbsent.mock.calls[0];
      // Upper bound is now minus the grace period: anything later would be
      // rejected by markAutoAbsent's own guard.
      expect(endedBefore).toEqual(new Date('2026-08-05T11:45:00Z'));
      expect(endedAfter).toEqual(new Date('2026-08-04T12:00:00Z'));
    });

    it('skips an event another tick or replica already claimed', async () => {
      findEventsPendingAutoAbsent.mockResolvedValue([
        { id: 'evt-1', chapter_id: 'chap-1', end_time: '2026-08-05T10:00:00Z' },
      ]);
      claimDispatch.mockResolvedValue(false);

      const result = await service.sweepAutoAbsent(NOW);

      expect(result).toEqual({ events: 0 });
      expect(markAutoAbsent).not.toHaveBeenCalled();
    });

    it('releases the claim when marking fails, so the next tick retries', async () => {
      findEventsPendingAutoAbsent.mockResolvedValue([
        {
          id: 'evt-bad',
          chapter_id: 'chap-1',
          end_time: '2026-08-05T10:00:00Z',
        },
        {
          id: 'evt-ok',
          chapter_id: 'chap-1',
          end_time: '2026-08-05T10:00:00Z',
        },
      ]);
      markAutoAbsent.mockRejectedValueOnce(new Error('event vanished'));

      const result = await service.sweepAutoAbsent(NOW);

      expect(result).toEqual({ events: 1 });
      expect(releaseDispatch).toHaveBeenCalledWith(
        'chap-1',
        'EVENT',
        'evt-bad',
        'AUTO_ABSENT',
        TODAY,
      );
      // The sweep keeps going after the failure.
      expect(markAutoAbsent).toHaveBeenCalledWith('evt-ok', 'chap-1');
    });

    it('skips an event with no valid end_time and sweeps the rest (#3498)', async () => {
      findEventsPendingAutoAbsent.mockResolvedValue([
        { id: 'evt-null', chapter_id: 'chap-1', end_time: null },
        { id: 'evt-junk', chapter_id: 'chap-1', end_time: 'not a date' },
        {
          id: 'evt-ok',
          chapter_id: 'chap-1',
          end_time: '2026-08-05T10:00:00Z',
        },
      ]);

      const result = await service.sweepAutoAbsent(NOW);

      expect(result).toEqual({ events: 1 });
      expect(markAutoAbsent).toHaveBeenCalledTimes(1);
      expect(markAutoAbsent).toHaveBeenCalledWith('evt-ok', 'chap-1');
      // One report for the site, however many rows share the fault.
      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(captureMessage).toHaveBeenCalledWith(
        'caught failure: auto-absent-sweep-invalid-end-time',
        expect.objectContaining({
          level: 'warning',
          fingerprint: ['caught-failure', 'auto-absent-sweep-invalid-end-time'],
        }),
      );
    });

    it('does not log PostgREST details when marking throws a plain object', async () => {
      const details =
        'Key (email)=(alice@example.com) is not present in table "users".';
      findEventsPendingAutoAbsent.mockResolvedValue([
        {
          id: 'evt-bad',
          chapter_id: 'chap-1',
          end_time: '2026-08-05T10:00:00Z',
        },
      ]);
      markAutoAbsent.mockRejectedValue({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details,
        hint: 'Use a different email.',
      });
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      try {
        const result = await service.sweepAutoAbsent(NOW);
        expect(result).toEqual({ events: 0 });
        expect(releaseDispatch).toHaveBeenCalled();
        const printed = warnSpy.mock.calls
          .map((args) =>
            args.map((arg) =>
              typeof arg === 'string' ? arg : JSON.stringify(arg),
            ),
          )
          .flat()
          .join('\n');
        expect(printed).toContain('auto-absent sweep: event evt-bad failed');
        expect(printed).toContain('23505');
        expect(printed).not.toContain('alice@example.com');
        expect(
          warnSpy.mock.calls
            .filter((args) =>
              String(args[0]).includes(
                'auto-absent sweep: event evt-bad failed',
              ),
            )
            .every((args) => args.length === 1),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('sweepEventReminders', () => {
    const UPCOMING = {
      id: 'evt-1',
      chapter_id: 'chap-1',
      name: 'Chapter Meeting',
      start_time: '2026-08-05T12:20:00Z',
      is_mandatory: true,
      required_role_ids: null,
    };

    it('skips an event with no valid start_time and reminds the rest (#3498)', async () => {
      findEventsStartingBetween.mockResolvedValue([
        { ...UPCOMING, id: 'evt-bad', start_time: 'not a date' },
        UPCOMING,
      ]);
      resolveRequiredMembers.mockResolvedValue([
        { user_id: 'user-1', role_ids: [] },
      ]);

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 1,
      });
      expect(notifyUser).toHaveBeenCalledTimes(1);
      // The guard's own error, not `toISOString`'s RangeError, so the event
      // that failed is the one named.
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'event evt-bad has no valid start_time',
        }),
        expect.objectContaining({
          level: 'warning',
          fingerprint: expect.arrayContaining(['event-reminder-sweep-event']),
        }),
      );
    });

    it('notifies every required member that the event is starting soon', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      resolveRequiredMembers.mockResolvedValue([
        { user_id: 'user-1', role_ids: [] },
        { user_id: 'user-2', role_ids: [] },
      ]);

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 1,
      });

      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith('user-1', 'chap-1', {
        title: 'Chapter Meeting',
        // 12:00 → 12:20 is 20 minutes, not the 30-minute window width.
        body: 'Starts in 20 minutes · Required',
        category: 'events',
        data: { target: { screen: 'events', eventId: 'evt-1' } },
      });
      expect(notifyUser).toHaveBeenCalledWith(
        'user-2',
        'chap-1',
        expect.anything(),
      );
    });

    // The copy must report the real remaining time. A member told "30 minutes"
    // who actually has 4 misses a mandatory event's check-in and is auto-marked
    // ABSENT, so this is the case worth pinning hardest.
    it.each([
      ['2026-08-05T12:29:30Z', 'Starts in 30 minutes'],
      ['2026-08-05T12:15:00Z', 'Starts in 15 minutes'],
      ['2026-08-05T12:04:00Z', 'Starts in 4 minutes'],
      ['2026-08-05T12:01:00Z', 'Starts in 1 minute'],
      ['2026-08-05T12:00:20Z', 'Starting now'],
    ])('reports the real lead time for %s', async (startTime, phrase) => {
      findEventsStartingBetween.mockResolvedValue([
        { ...UPCOMING, start_time: startTime },
      ]);

      await service.sweepEventReminders(NOW);

      expect(notifyUser.mock.calls[0][2].body).toBe(`${phrase} · Required`);
    });

    it('queries the window (now, now + lead] so a started event is never notified about', async () => {
      await service.sweepEventReminders(NOW);

      expect(findEventsStartingBetween).toHaveBeenCalledWith(
        NOW,
        new Date('2026-08-05T12:30:00Z'),
      );
    });

    it('claims on the event start date, so every tick in the window computes the same key', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);

      await service.sweepEventReminders(NOW);

      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'EVENT',
        'evt-1',
        'EVENT_REMINDER',
        TODAY,
      );
    });

    // The claim is what makes the other five ticks in the window cheap, so
    // "lost the claim" must cost nothing beyond the failed insert — in
    // particular it must not read the chapter roster.
    it('sends nothing, and does not read the roster, when another replica already claimed it', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      claimDispatch.mockResolvedValue(false);

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 0,
      });
      expect(notifyUser).not.toHaveBeenCalled();
      expect(resolveRequiredMembers).not.toHaveBeenCalled();
    });

    it('releases the claim when the event requires nobody, so a later member still gets reminded', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      resolveRequiredMembers.mockResolvedValue([]);

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 0,
      });
      expect(notifyUser).not.toHaveBeenCalled();
      // Claimed, then released — not stranded. An event that gains its first
      // required member later in the window must still be claimable.
      expect(releaseDispatch).toHaveBeenCalledWith(
        'chap-1',
        'EVENT',
        'evt-1',
        'EVENT_REMINDER',
        TODAY,
      );
    });

    it('releases the claim when the roster read fails, rather than stranding it', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      resolveRequiredMembers.mockRejectedValue(new Error('roster read failed'));

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 0,
      });
      expect(releaseDispatch).toHaveBeenCalledWith(
        'chap-1',
        'EVENT',
        'evt-1',
        'EVENT_REMINDER',
        TODAY,
      );
    });

    it('resolves the audience through AttendanceService, not from the event row', async () => {
      const targeted = {
        ...UPCOMING,
        is_mandatory: false,
        required_role_ids: ['role-exec'],
      };
      findEventsStartingBetween.mockResolvedValue([targeted]);

      await service.sweepEventReminders(NOW);

      // The whole point of sharing the predicate: a role-targeted event's
      // audience is never re-derived here, so it cannot drift from the
      // visibility rule GET /v1/events enforces.
      expect(resolveRequiredMembers).toHaveBeenCalledWith('chap-1', targeted);
    });

    it('releases the claim when every delivery failed, so the next tick retries', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      notifyUser.mockRejectedValue(new Error('push provider down'));

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 0,
      });
      expect(releaseDispatch).toHaveBeenCalledWith(
        'chap-1',
        'EVENT',
        'evt-1',
        'EVENT_REMINDER',
        TODAY,
      );
    });

    it('keeps the claim on partial delivery rather than re-notifying the members who got it', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      resolveRequiredMembers.mockResolvedValue([
        { user_id: 'user-1', role_ids: [] },
        { user_id: 'user-2', role_ids: [] },
      ]);
      notifyUser
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('unreachable'));

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 1,
      });
      expect(releaseDispatch).not.toHaveBeenCalled();
    });

    it('reports a partial delivery under its sweep, as the drop it is', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);
      resolveRequiredMembers.mockResolvedValue([
        { user_id: 'user-1', role_ids: [] },
        { user_id: 'user-2', role_ids: [] },
        { user_id: 'user-3', role_ids: [] },
      ]);
      notifyUser
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('unreachable'))
        .mockRejectedValueOnce(new Error('unreachable'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      try {
        await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
          sent: 1,
        });

        expect(captureMessage).toHaveBeenCalledTimes(1);
        expect(captureMessage).toHaveBeenCalledWith(
          'caught failure: scheduled-reminder-partial-delivery:event.event-reminder',
          expect.objectContaining({
            level: 'error',
            fingerprint: [
              'caught-failure',
              'scheduled-reminder-partial-delivery:event.event-reminder',
            ],
          }),
        );
        // Each failed recipient is a warning, and the per-site throttle keeps
        // a fan-out from becoming one event per member.
        expect(captureException).toHaveBeenCalledTimes(1);
        expect(captureException).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ level: 'warning' }),
        );
        expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(
          'user-2',
        );
        expect(errorSpy).toHaveBeenCalledWith(
          'EVENT evt-1 (EVENT_REMINDER): delivered to 1/3 recipients; not retrying',
        );
      } finally {
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it('sends at the default NORMAL priority so quiet hours and the events preference still apply', async () => {
      findEventsStartingBetween.mockResolvedValue([UPCOMING]);

      await service.sweepEventReminders(NOW);

      // Passing no `priority` is load-bearing: NotificationService exempts
      // URGENT from both the category preference and quiet hours, so naming a
      // priority here would silently opt reminders out of both.
      expect(notifyUser.mock.calls[0][2]).not.toHaveProperty('priority');
    });

    it('keeps sweeping when one event cannot resolve its audience', async () => {
      findEventsStartingBetween.mockResolvedValue([
        UPCOMING,
        { ...UPCOMING, id: 'evt-2', name: 'Rush Night' },
      ]);
      resolveRequiredMembers
        .mockRejectedValueOnce(new Error('roster read failed'))
        .mockResolvedValueOnce([{ user_id: 'user-1', role_ids: [] }]);

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 1,
      });
      expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    // The per-event catch is the reason handleEventReminderSweep needs no
    // try/catch of its own: a rejection out of a @Cron would reach only
    // Nest's raw logger.error, which no alert sees, and drop the rest. Pinned
    // against the one call the lazy-recipients path does NOT absorb.
    it('isolates a per-event failure rather than rejecting out of the sweep', async () => {
      findEventsStartingBetween.mockResolvedValue([
        UPCOMING,
        { ...UPCOMING, id: 'evt-2', name: 'Rush Night' },
      ]);
      claimDispatch
        .mockRejectedValueOnce(new Error('claim exploded'))
        .mockResolvedValueOnce(true);

      await expect(service.sweepEventReminders(NOW)).resolves.toEqual({
        sent: 1,
      });
    });
  });

  describe('sweepInvoiceReminders', () => {
    afterEach(() => {
      mockBetaOff.keys = [];
    });

    it('sends nothing, and reads no invoices, while dues is beta-off', async () => {
      mockBetaOff.keys = ['dues'];
      findOpenInvoicesDueBetween.mockResolvedValue([INVOICE]);

      await expect(service.sweepInvoiceReminders(NOW)).resolves.toEqual({
        sent: 0,
      });
      expect(findOpenInvoicesDueBetween).not.toHaveBeenCalled();
    });

    it('notifies the member about an invoice due tomorrow', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([INVOICE]);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'INVOICE',
        'inv-1',
        'DUE_SOON',
        TOMORROW,
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({
          title: 'Payment due tomorrow',
          body: 'Fall Dues ($250.00) is due tomorrow.',
          category: 'billing',
          data: { target: { screen: 'billing' } },
        }),
      );
    });

    // Regression: `isNewlyOverdue` used `<=`, which called an invoice overdue
    // on the morning it was due — contradicting GET /invoices/overdue, which
    // uses `due_date < today - grace`.
    it('does not call an invoice overdue on its own due date', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, due_date: TODAY },
      ]);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({
          title: 'Payment due today',
          body: 'Fall Dues ($250.00) is due today.',
        }),
      );
      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'INVOICE',
        'inv-1',
        'DUE_SOON',
        TODAY,
      );
    });

    it('does not call an invoice overdue on the last day of its grace', async () => {
      // due 07-29 + 7 days grace lands exactly on today; overdue starts the
      // day after.
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, due_date: '2026-07-29' },
      ]);
      getDuesGraceDays.mockResolvedValue(7);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('notifies once an invoice passes due_date plus the chapter dues grace', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, due_date: '2026-07-28' },
      ]);
      getDuesGraceDays.mockResolvedValue(7);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'INVOICE',
        'inv-1',
        'OVERDUE',
        '2026-07-28',
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({ title: 'Payment overdue' }),
      );
    });

    it('does not notify when the dispatch claim is already held', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([INVOICE]);
      claimDispatch.mockResolvedValue(false);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('ignores debt that went overdue before the lookback window', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, due_date: '2026-06-01' },
      ]);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('resolves the dues grace once per chapter, not once per invoice', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, id: 'inv-1', due_date: '2026-07-28' },
        { ...INVOICE, id: 'inv-2', due_date: '2026-07-27' },
      ]);

      await service.sweepInvoiceReminders(NOW);

      expect(getDuesGraceDays).toHaveBeenCalledTimes(1);
    });

    // Regression: the claim is taken before the send, so a send that fails
    // must give the claim back or the reminder is lost forever.
    it('releases the claim when delivery fails entirely', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([INVOICE]);
      notifyUser.mockRejectedValue(new Error('supabase down'));

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(releaseDispatch).toHaveBeenCalledWith(
        'chap-1',
        'INVOICE',
        'inv-1',
        'DUE_SOON',
        TOMORROW,
      );
    });
  });

  describe('sweepTaskReminders', () => {
    it('notifies the assignee one day before the due date', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([TASK]);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({
          title: 'Task due tomorrow',
          category: 'tasks',
          data: { target: { screen: 'tasks', taskId: 'task-1' } },
        }),
      );
    });

    // A missed 09:00 tick must degrade to a late nudge, not silence.
    it('still nudges on the due date itself when a tick was missed', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: TODAY },
      ]);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({ title: 'Task due today' }),
      );
    });

    it('notifies assignee and assigner when a task is overdue', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-04' },
      ]);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({
          title: 'Book the venue',
          body: 'Overdue · was due Tue, Aug 4',
        }),
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'admin-1',
        'chap-1',
        expect.objectContaining({ title: 'Book the venue' }),
      );
    });

    // Removing a member leaves tasks.created_by pointing at them; they must
    // not keep receiving that chapter's task titles.
    it('does not notify an assigner who has left the chapter', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-04' },
      ]);
      findByUserAndChapter.mockResolvedValue(null);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({ title: 'Book the venue' }),
      );
    });

    it('sends a single notification for a self-assigned overdue task', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-04', created_by: 'user-1' },
      ]);

      await service.sweepTaskReminders(NOW);

      expect(notifyUser).toHaveBeenCalledTimes(1);
      // A self-assigned task needs no membership lookup for the assigner.
      expect(findByUserAndChapter).not.toHaveBeenCalled();
    });

    // One recipient failing must not silence the other — the spec requires
    // both the assignee and the assigner to hear about an overdue task.
    it('still notifies the assigner when the assignee delivery fails', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-04' },
      ]);
      notifyUser.mockRejectedValueOnce(new Error('push token rejected'));

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenLastCalledWith(
        'admin-1',
        'chap-1',
        expect.objectContaining({ title: 'Book the venue' }),
      );
      // Partial delivery keeps the claim: retrying would re-spam the
      // recipient who did receive it.
      expect(releaseDispatch).not.toHaveBeenCalled();
    });

    it('does not notify when the dispatch claim is already held', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-04' },
      ]);
      claimDispatch.mockResolvedValue(false);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(notifyUser).not.toHaveBeenCalled();
    });

    // Tasks have no per-chapter grace, so the 7-day overdue lookback is
    // enforced entirely by the query window rather than re-checked in code.
    it('bounds the task query to the lookback and lead-time window', async () => {
      await service.sweepTaskReminders(NOW);

      expect(findIncompleteTasksDueBetween).toHaveBeenCalledWith(
        '2026-07-29',
        TOMORROW,
      );
    });
  });

  describe('sweepExpiredPolls', () => {
    const POLL = {
      id: 'poll-1',
      chapter_id: 'chap-1',
      channel_id: 'chan-1',
      expires_at: '2026-08-05T10:00:00Z',
    };

    it('announces a poll whose deadline has passed', async () => {
      findExpiredPollsPendingNotice.mockResolvedValue([POLL]);

      const result = await service.sweepExpiredPolls(NOW);

      expect(result).toEqual({ announced: 1 });
      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'POLL',
        'poll-1',
        'EXPIRED',
        '2026-08-05',
      );
      expect(announceExpiry).toHaveBeenCalledWith('poll-1', 'chan-1');
    });

    it('queries a bounded lookback window ending now', async () => {
      await service.sweepExpiredPolls(NOW);

      expect(findExpiredPollsPendingNotice).toHaveBeenCalledWith(
        new Date('2026-08-04T12:00:00Z'),
        NOW,
      );
    });

    // expires_at is validated only as a string (CreatePollDto), so a
    // malformed value can reach the sweep. `new Date(bad).toISOString()`
    // throws a generic RangeError; this must be caught with a specific,
    // named log line rather than silently retrying every tick until the
    // poll ages out of the lookback window.
    it('skips a poll with an unparseable expires_at, without claiming it', async () => {
      findExpiredPollsPendingNotice.mockResolvedValue([
        { ...POLL, expires_at: 'not-a-date' },
      ]);

      const result = await service.sweepExpiredPolls(NOW);

      expect(result).toEqual({ announced: 0 });
      expect(claimDispatch).not.toHaveBeenCalled();
      expect(announceExpiry).not.toHaveBeenCalled();
    });

    it('reports an unparseable expires_at without sending the member-supplied value', async () => {
      findExpiredPollsPendingNotice.mockResolvedValue([
        { ...POLL, expires_at: 'next tuesday-ish' },
      ]);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(service.sweepExpiredPolls(NOW)).resolves.toEqual({
          announced: 0,
        });
        expect(captureMessage).toHaveBeenCalledTimes(1);
        expect(captureMessage).toHaveBeenCalledWith(
          'caught failure: poll-expiry-sweep-unparseable-expires-at',
          expect.objectContaining({
            level: 'error',
            fingerprint: [
              'caught-failure',
              'poll-expiry-sweep-unparseable-expires-at',
            ],
          }),
        );
        expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(
          'next tuesday-ish',
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('skips a poll another tick or replica already claimed', async () => {
      findExpiredPollsPendingNotice.mockResolvedValue([POLL]);
      claimDispatch.mockResolvedValue(false);

      const result = await service.sweepExpiredPolls(NOW);

      expect(result).toEqual({ announced: 0 });
      expect(announceExpiry).not.toHaveBeenCalled();
    });

    // The claim is taken before the post, so a failed post must give the
    // claim back or the announcement is lost forever.
    it('releases the claim when the announcement post fails', async () => {
      findExpiredPollsPendingNotice.mockResolvedValue([POLL]);
      announceExpiry.mockRejectedValue(new Error('insert failed'));

      const result = await service.sweepExpiredPolls(NOW);

      expect(result).toEqual({ announced: 0 });
      expect(releaseDispatch).toHaveBeenCalledWith(
        'chap-1',
        'POLL',
        'poll-1',
        'EXPIRED',
        '2026-08-05',
      );
    });

    it('keeps sweeping after one poll fails', async () => {
      findExpiredPollsPendingNotice.mockResolvedValue([
        { ...POLL, id: 'poll-bad' },
        { ...POLL, id: 'poll-ok' },
      ]);
      claimDispatch.mockRejectedValueOnce(new Error('db down'));

      const result = await service.sweepExpiredPolls(NOW);

      expect(result).toEqual({ announced: 1 });
      expect(announceExpiry).toHaveBeenCalledTimes(1);
    });
  });

  describe('sweepExpiredReports', () => {
    it('delegates to the retention service with the sweep clock', async () => {
      // The work list is storage-derived, so this handler passes only `now`.
      // Nothing reads the chapters table — a DB error therefore cannot masquerade
      // as "no chapters to sweep".
      sweepExpiredReports.mockResolvedValue({ deleted: 3, failed: 0 });

      const result = await service.sweepExpiredReports(NOW);

      expect(sweepExpiredReports).toHaveBeenCalledWith(NOW);
      expect(result).toEqual({ deleted: 3, failed: 0 });
    });

    it('passes the real clock through the cron wrapper', async () => {
      await service.handleReportRetentionSweep();

      expect(sweepExpiredReports).toHaveBeenCalledWith(expect.any(Date));
    });

    it('does not let a storage failure escape the cron handler', async () => {
      // @nestjs/schedule would catch a rejection, but log the raw object and
      // report nothing: this sweep reaches storage directly, so it catches
      // its own.
      sweepExpiredReports.mockRejectedValue(new Error('storage down'));

      await expect(
        service.handleReportRetentionSweep(),
      ).resolves.toBeUndefined();
    });

    it('a caught failure that drops work reports to Sentry', async () => {
      sweepExpiredReports.mockRejectedValue(new TypeError('fetch failed'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      try {
        await expect(
          service.handleReportRetentionSweep(),
        ).resolves.toBeUndefined();

        expect(captureException).toHaveBeenCalledTimes(1);
        const [reported, context] = captureException.mock.calls[0] as [
          Error,
          { level: string; fingerprint: string[] },
        ];
        expect(reported.message).toBe('fetch failed');
        expect(context.level).toBe('error');
        expect(context.fingerprint).toEqual([
          'caught-failure',
          'report-retention-sweep-enumerate',
          'TypeError',
        ]);
        expect(captureMessage).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
          'report retention sweep: could not enumerate the reports bucket; skipping this tick: fetch failed',
          expect.any(String),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  // Resolved chat reports whose evidence release did not finish (#2481).
  describe('handleChatReportEvidenceSweep', () => {
    it('passes the real clock to the chat report service', async () => {
      sweepPendingEvidenceReleases.mockResolvedValue(2);

      await service.handleChatReportEvidenceSweep();

      expect(sweepPendingEvidenceReleases).toHaveBeenCalledWith(
        expect.any(Date),
      );
    });

    it('does not let a failed candidate read escape the cron handler', async () => {
      // The candidate read throws on a query error; @nestjs/schedule would
      // log that raw object and report nothing.
      sweepPendingEvidenceReleases.mockRejectedValue({
        code: 'XX000',
        message: 'boom',
      });

      await expect(
        service.handleChatReportEvidenceSweep(),
      ).resolves.toBeUndefined();
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          level: 'error',
          fingerprint: expect.arrayContaining([
            'caught-failure',
            'chat-report-evidence-sweep-read',
          ]) as unknown,
        }),
      );
    });
  });

  describe('sweepStalePalettes', () => {
    it('asks for every row the running engine did not write', async () => {
      await service.sweepStalePalettes();

      expect(findChaptersWithStalePalette).toHaveBeenCalledWith(
        SIGNET_ENGINE_VERSION,
      );
    });

    it('recomputes each through buildChapterPalette from its branding seed, and stamps it', async () => {
      findChaptersWithStalePalette.mockResolvedValue([
        { id: 'chap-crimson', seed: '#8B0000' },
        { id: 'chap-house', seed: null },
      ]);

      const result = await service.sweepStalePalettes();

      expect(result).toEqual({ recomputed: 2, superseded: 0, failed: 0 });
      // The whole map, exactly as every writer builds it: no key-sniffing,
      // and no second derivation path to drift from the writers'.
      expect(writeRecomputedPalette).toHaveBeenCalledWith(
        { id: 'chap-crimson', seed: '#8B0000' },
        {
          theme_palette: buildChapterPalette({ accent: '#8B0000' }).palette,
          theme_palette_engine_version: SIGNET_ENGINE_VERSION,
        },
      );
      // No accent picked is the house seed, per accent-engine.md §3.
      expect(writeRecomputedPalette).toHaveBeenCalledWith(
        { id: 'chap-house', seed: null },
        {
          theme_palette: buildChapterPalette({}).palette,
          theme_palette_engine_version: SIGNET_ENGINE_VERSION,
        },
      );
    });

    it('counts a lost compare-and-set apart from a failure, and leaves the row to its newer write', async () => {
      findChaptersWithStalePalette.mockResolvedValue([
        { id: 'chap-1', seed: '#8B0000' },
        { id: 'chap-2', seed: '#003087' },
      ]);
      writeRecomputedPalette
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await service.sweepStalePalettes();

      expect(result).toEqual({ recomputed: 1, superseded: 1, failed: 0 });
      expect(writeRecomputedPalette).toHaveBeenCalledTimes(2);
    });

    it("does not let one chapter's failed write stop the rest", async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      findChaptersWithStalePalette.mockResolvedValue([
        { id: 'chap-1', seed: '#8B0000' },
        { id: 'chap-2', seed: '#003087' },
      ]);
      writeRecomputedPalette
        .mockRejectedValueOnce(new Error('statement timeout'))
        .mockResolvedValueOnce(true);

      const result = await service.sweepStalePalettes();

      expect(result).toEqual({ recomputed: 1, superseded: 0, failed: 1 });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('palette sweep: chapter chap-1'),
      );
      warn.mockRestore();
    });

    it('logs a bad seed once and still writes, so the row is not retried forever', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      findChaptersWithStalePalette.mockResolvedValue([
        { id: 'chap-1', seed: 'not-a-colour' },
      ]);

      const result = await service.sweepStalePalettes();

      expect(result.recomputed).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid accent seed for chapter chap-1'),
      );
      warn.mockRestore();
    });

    it('writes nothing and logs nothing when every row is current', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      const result = await service.sweepStalePalettes();

      expect(result).toEqual({ recomputed: 0, superseded: 0, failed: 0 });
      expect(writeRecomputedPalette).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it('runs through the cron wrapper without rejecting when a write fails', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      findChaptersWithStalePalette.mockResolvedValue([
        { id: 'chap-1', seed: '#8B0000' },
      ]);
      writeRecomputedPalette.mockRejectedValue(new Error('down'));

      await expect(service.handleStalePaletteSweep()).resolves.toBeUndefined();
      expect(writeRecomputedPalette).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
