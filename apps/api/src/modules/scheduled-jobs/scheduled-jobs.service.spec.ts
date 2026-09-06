import { Test } from '@nestjs/testing';
import { AttendanceService } from '../../application/services/attendance.service';
import { NotificationService } from '../../application/services/notification.service';
import { ChapterWorkflowsService } from '../../application/services/chapter-workflows.service';
import { ReportRetentionService } from '../../application/services/report-retention.service';
import { PollService } from '../../application/services/poll.service';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';

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

    const mod = await Test.createTestingModule({
      providers: [
        ScheduledJobsService,
        {
          provide: ScheduledJobsRepository,
          useValue: {
            findEventsPendingAutoAbsent,
            findOpenInvoicesDueBetween,
            findIncompleteTasksDueBetween,
            findExpiredPollsPendingNotice,
            findEventsStartingBetween,
            claimDispatch,
            releaseDispatch,
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
        title: 'Event starting soon',
        // 12:00 → 12:20 is 20 minutes, not the 30-minute window width.
        body: '"Chapter Meeting" starts in 20 minutes.',
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
      ['2026-08-05T12:29:30Z', 'starts in 30 minutes'],
      ['2026-08-05T12:15:00Z', 'starts in 15 minutes'],
      ['2026-08-05T12:04:00Z', 'starts in 4 minutes'],
      ['2026-08-05T12:01:00Z', 'starts in 1 minute'],
      ['2026-08-05T12:00:20Z', 'is starting now'],
    ])('reports the real lead time for %s', async (startTime, phrase) => {
      findEventsStartingBetween.mockResolvedValue([
        { ...UPCOMING, start_time: startTime },
      ]);

      await service.sweepEventReminders(NOW);

      expect(notifyUser.mock.calls[0][2].body).toBe(
        `"Chapter Meeting" ${phrase}.`,
      );
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
    // try/catch of its own, and an unhandled rejection out of a @Cron takes
    // the API process down under Node's --unhandled-rejections=throw. Pinned
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
        expect.objectContaining({ title: 'Task overdue' }),
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'admin-1',
        'chap-1',
        expect.objectContaining({ title: 'Task overdue' }),
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
        expect.objectContaining({ title: 'Task overdue' }),
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
        expect.objectContaining({ title: 'Task overdue' }),
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
      question: 'Pizza or tacos?',
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
      expect(announceExpiry).toHaveBeenCalledWith(
        'poll-1',
        'chan-1',
        'Pizza or tacos?',
      );
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
      // An unhandled rejection out of a @Cron handler is fatal under Node's
      // default --unhandled-rejections=throw: this sweep reaches storage
      // directly, so an outage would otherwise restart the API every hour.
      sweepExpiredReports.mockRejectedValue(new Error('storage down'));

      await expect(
        service.handleReportRetentionSweep(),
      ).resolves.toBeUndefined();
    });
  });
});
