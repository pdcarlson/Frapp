import { Test } from '@nestjs/testing';
import { AttendanceService } from '../../application/services/attendance.service';
import { NotificationService } from '../../application/services/notification.service';
import { ChapterWorkflowsService } from '../../application/services/chapter-workflows.service';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';

/**
 * Fixed clock for every sweep. The sweeps take `now` as a parameter precisely
 * so these tests never depend on the wall clock — a suite that passed only in
 * some hours of the day would be worse than no suite.
 */
const NOW = new Date('2026-08-05T12:00:00Z');
const TOMORROW = '2026-08-06';

describe('ScheduledJobsService', () => {
  let service: ScheduledJobsService;
  let markAutoAbsent: jest.Mock;
  let notifyUser: jest.Mock;
  let getDuesGraceDays: jest.Mock;
  let claimDispatch: jest.Mock;
  let findEventsPendingAutoAbsent: jest.Mock;
  let findOpenInvoicesDueBetween: jest.Mock;
  let findIncompleteTasksDueBetween: jest.Mock;

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
    findEventsPendingAutoAbsent = jest.fn().mockResolvedValue([]);
    findOpenInvoicesDueBetween = jest.fn().mockResolvedValue([]);
    findIncompleteTasksDueBetween = jest.fn().mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [
        ScheduledJobsService,
        {
          provide: ScheduledJobsRepository,
          useValue: {
            findEventsPendingAutoAbsent,
            findOpenInvoicesDueBetween,
            findIncompleteTasksDueBetween,
            claimDispatch,
          },
        },
        { provide: AttendanceService, useValue: { markAutoAbsent } },
        { provide: NotificationService, useValue: { notifyUser } },
        { provide: ChapterWorkflowsService, useValue: { getDuesGraceDays } },
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

    it('keeps sweeping after one event fails', async () => {
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
      expect(markAutoAbsent).toHaveBeenCalledWith('evt-ok', 'chap-1');
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
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({
          title: 'Payment due tomorrow',
          body: 'Fall Dues ($250.00) is due tomorrow.',
          category: 'billing',
        }),
      );
    });

    it('does not notify when the dispatch claim is already held', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([INVOICE]);
      claimDispatch.mockResolvedValue(false);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('notifies once an invoice passes due_date plus the chapter dues grace', async () => {
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, due_date: '2026-07-30' },
      ]);

      const result = await service.sweepInvoiceReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'INVOICE',
        'inv-1',
        'OVERDUE',
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({ title: 'Payment overdue' }),
      );
    });

    it('respects the chapter dues grace before calling an invoice overdue', async () => {
      // Due yesterday, but the chapter allows a 7-day grace, so it is not
      // overdue yet.
      findOpenInvoicesDueBetween.mockResolvedValue([
        { ...INVOICE, due_date: '2026-08-04' },
      ]);
      getDuesGraceDays.mockResolvedValue(7);

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
        { ...INVOICE, id: 'inv-1', due_date: '2026-07-30' },
        { ...INVOICE, id: 'inv-2', due_date: '2026-07-31' },
      ]);

      await service.sweepInvoiceReminders(NOW);

      expect(getDuesGraceDays).toHaveBeenCalledTimes(1);
    });
  });

  describe('sweepTaskReminders', () => {
    it('notifies the assignee one day before the due date', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([TASK]);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 1 });
      expect(claimDispatch).toHaveBeenCalledWith(
        'chap-1',
        'TASK',
        'task-1',
        'DUE_SOON',
      );
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'user-1',
        'chap-1',
        expect.objectContaining({
          title: 'Task due tomorrow',
          category: 'tasks',
        }),
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

    it('sends a single notification for a self-assigned overdue task', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-04', created_by: 'user-1' },
      ]);

      await service.sweepTaskReminders(NOW);

      expect(notifyUser).toHaveBeenCalledTimes(1);
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

    it('does not treat a task due today as overdue', async () => {
      findIncompleteTasksDueBetween.mockResolvedValue([
        { ...TASK, due_date: '2026-08-05' },
      ]);

      const result = await service.sweepTaskReminders(NOW);

      expect(result).toEqual({ sent: 0 });
      expect(notifyUser).not.toHaveBeenCalled();
    });
  });
});
