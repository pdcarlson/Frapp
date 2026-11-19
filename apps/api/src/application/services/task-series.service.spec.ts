import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TaskSeriesService } from './task-series.service';
import type { TaskService } from './task.service';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  TaskStatus,
  type Task,
  type TaskSeries,
} from '#domain/entities/task.entity';

const RULE = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York';

const SERIES: TaskSeries = {
  id: 'series-1',
  chapter_id: 'ch-1',
  created_by: 'admin-1',
  title: 'Kitchen duty',
  description: null,
  assignee_id: 'user-1',
  point_reward: 5,
  proof_kind: 'none',
  subtask_titles: [],
  due_time: '21:00:00',
  recurrence_rule: RULE,
  first_due_date: '2026-11-09',
  next_due_date: '2026-11-23',
  latest_due_at: '2026-11-17T02:00:00.000Z',
  made_count: 2,
  ended_at: null,
  created_at: '2026-11-01T00:00:00.000Z',
};

/** A copy; the open one (Nov 16) unless overridden. */
const copy = (over: Partial<Task> = {}): Task => ({
  id: 'open',
  chapter_id: 'ch-1',
  title: 'Kitchen duty',
  description: null,
  assignee_id: 'user-1',
  created_by: 'admin-1',
  due_date: '2026-11-16',
  due_at: '2026-11-17T02:00:00.000Z',
  status: TaskStatus.TODO,
  point_reward: 5,
  points_awarded: false,
  completed_at: null,
  confirmed_at: null,
  sent_back_at: null,
  proof_kind: 'none',
  proof_link: null,
  sent_back_reason: null,
  completion_note: null,
  series_id: 'series-1',
  occurrence_date: '2026-11-16',
  group_id: null,
  meeting_id: null,
  created_at: '2026-11-10T00:00:00.000Z',
  ...over,
});

describe('TaskSeriesService (#5119)', () => {
  let repo: jest.Mocked<
    Pick<
      ITaskRepository,
      | 'findById'
      | 'findSeries'
      | 'findLatestSeriesCopy'
      | 'updateSeriesIfNext'
      | 'findPhotos'
      | 'hasCheckedSubtask'
    >
  >;
  let members: jest.Mocked<Pick<IMemberRepository, 'findByUserAndChapter'>>;
  let tasks: jest.Mocked<Pick<TaskService, 'update' | 'findById' | 'delete'>>;
  let service: TaskSeriesService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-12T12:00:00.000Z') });
    repo = {
      findById: jest.fn().mockResolvedValue(copy()),
      findSeries: jest.fn().mockResolvedValue([SERIES]),
      findLatestSeriesCopy: jest.fn().mockResolvedValue(copy()),
      updateSeriesIfNext: jest.fn().mockResolvedValue(SERIES),
      findPhotos: jest.fn().mockResolvedValue([]),
      hasCheckedSubtask: jest.fn().mockResolvedValue(false),
    };
    members = {
      findByUserAndChapter: jest.fn().mockResolvedValue({ id: 'm' }),
    };
    tasks = {
      update: jest.fn().mockResolvedValue({ id: 'open' }),
      findById: jest.fn().mockResolvedValue({ id: 'old' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskSeriesService(
      repo as unknown as ITaskRepository,
      members as unknown as IMemberRepository,
      tasks as unknown as TaskService,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('update with "All upcoming tasks"', () => {
    it('changes the template and the open copy, comparing on next_due_date', async () => {
      await service.update('open', 'ch-1', 'admin-1', {
        title: 'Kitchen',
        point_reward: 8,
      });

      expect(repo.updateSeriesIfNext).toHaveBeenCalledWith(
        'ch-1',
        'series-1',
        '2026-11-23',
        { title: 'Kitchen', point_reward: 8 },
      );
      expect(tasks.update).toHaveBeenCalledWith(
        'open',
        'ch-1',
        'admin-1',
        expect.objectContaining({ title: 'Kitchen', point_reward: 8 }),
      );
    });

    it('never changes a copy that is marked done', async () => {
      repo.findLatestSeriesCopy.mockResolvedValue(
        copy({ status: TaskStatus.COMPLETED }),
      );

      await service.update('open', 'ch-1', 'admin-1', { title: 'Kitchen' });

      expect(repo.updateSeriesIfNext).toHaveBeenCalled();
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it('changes the open copy, not an older overdue one being edited', async () => {
      repo.findById.mockResolvedValue(
        copy({ id: 'old', occurrence_date: '2026-11-09' }),
      );

      await service.update('old', 'ch-1', 'admin-1', { title: 'Kitchen' });

      expect(tasks.update).toHaveBeenCalledWith(
        'open',
        'ch-1',
        'admin-1',
        expect.anything(),
      );
      expect(tasks.findById).toHaveBeenCalledWith('old', 'ch-1');
    });

    it('moves the time of day for the next copies and the open one', async () => {
      // 8 PM New York on the open copy's day.
      await service.update('open', 'ch-1', 'admin-1', {
        due_at: '2026-11-17T01:00:00.000Z',
      });

      expect(repo.updateSeriesIfNext).toHaveBeenCalledWith(
        'ch-1',
        'series-1',
        '2026-11-23',
        {
          due_time: '20:00:00',
          next_due_date: '2026-11-23',
          latest_due_at: '2026-11-17T01:00:00.000Z',
        },
      );
      expect(tasks.update).toHaveBeenCalledWith(
        'open',
        'ch-1',
        'admin-1',
        expect.objectContaining({
          due_date: '2026-11-16',
          due_at: '2026-11-17T01:00:00.000Z',
        }),
      );
    });

    it('counts a new rule from the open copy and re-steps the next one', async () => {
      const thursdays = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;TZID=America/New_York';

      await service.update('open', 'ch-1', 'admin-1', {
        recurrence_rule: thursdays,
      });

      expect(repo.updateSeriesIfNext).toHaveBeenCalledWith(
        'ch-1',
        'series-1',
        '2026-11-23',
        expect.objectContaining({
          recurrence_rule: thursdays,
          first_due_date: '2026-11-16',
          next_due_date: '2026-11-19',
        }),
      );
    });

    it('ends the series after the open copy on a null rule', async () => {
      await service.update('open', 'ch-1', 'admin-1', {
        recurrence_rule: null,
      });

      expect(repo.updateSeriesIfNext).toHaveBeenCalledWith(
        'ch-1',
        'series-1',
        '2026-11-23',
        { ended_at: '2026-11-12T12:00:00.000Z' },
      );
    });

    it('never touches a latest copy that is already past due', async () => {
      // Due Nov 9, before "now" (Nov 12): an overdue record.
      repo.findLatestSeriesCopy.mockResolvedValue(
        copy({
          id: 'old',
          due_date: '2026-11-09',
          due_at: '2026-11-10T02:00:00.000Z',
          occurrence_date: '2026-11-09',
        }),
      );

      await service.update('open', 'ch-1', 'admin-1', {
        title: 'Kitchen',
        assignee_id: 'user-2',
      });

      expect(repo.updateSeriesIfNext).toHaveBeenCalled();
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it('refuses moving the open copy to another day, writing nothing', async () => {
      await expect(
        service.update('open', 'ch-1', 'admin-1', {
          due_date: '2026-11-18',
          due_at: '2026-11-19T02:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.updateSeriesIfNext).not.toHaveBeenCalled();
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it("accepts the copy's own day sent back with a new time", async () => {
      await service.update('open', 'ch-1', 'admin-1', {
        due_date: '2026-11-16',
        due_at: '2026-11-17T01:00:00.000Z',
      });

      expect(tasks.update).toHaveBeenCalledWith(
        'open',
        'ch-1',
        'admin-1',
        expect.objectContaining({
          due_date: '2026-11-16',
          due_at: '2026-11-17T01:00:00.000Z',
        }),
      );
    });

    it('keeps the series change when the copy was confirmed mid-edit', async () => {
      tasks.update.mockRejectedValue(
        new BadRequestException(
          'This task was confirmed while you were editing it',
        ),
      );

      await expect(
        service.update('open', 'ch-1', 'admin-1', { title: 'Kitchen' }),
      ).resolves.toEqual({ id: 'old' });
      expect(repo.updateSeriesIfNext).toHaveBeenCalled();
    });

    it('refuses a rule it cannot read', async () => {
      await expect(
        service.update('open', 'ch-1', 'admin-1', { recurrence_rule: 'X' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.updateSeriesIfNext).not.toHaveBeenCalled();
    });

    it('refuses an assignee outside the chapter', async () => {
      members.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.update('open', 'ch-1', 'admin-1', { assignee_id: 'stranger' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('is a conflict when the sweep moved the series on mid-edit', async () => {
      repo.updateSeriesIfNext.mockResolvedValue(null);

      await expect(
        service.update('open', 'ch-1', 'admin-1', { title: 'Kitchen' }),
      ).rejects.toThrow(ConflictException);
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it('refuses a task that does not repeat, or whose series ended', async () => {
      repo.findById.mockResolvedValueOnce(copy({ series_id: null }));
      await expect(
        service.update('open', 'ch-1', 'admin-1', { title: 'x' }),
      ).rejects.toThrow(BadRequestException);

      repo.findSeries.mockResolvedValueOnce([
        { ...SERIES, ended_at: '2026-11-11T00:00:00.000Z' },
      ]);
      await expect(
        service.update('open', 'ch-1', 'admin-1', { title: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete with "All upcoming tasks"', () => {
    it('ends the series and deletes an untouched open copy', async () => {
      const result = await service.delete('open', 'ch-1');

      expect(repo.updateSeriesIfNext).toHaveBeenCalledWith(
        'ch-1',
        'series-1',
        '2026-11-23',
        { ended_at: '2026-11-12T12:00:00.000Z' },
      );
      expect(tasks.delete).toHaveBeenCalledWith('open', 'ch-1');
      expect(result).toEqual({ deleted_task_id: 'open' });
    });

    it.each([
      ['started', { status: TaskStatus.IN_PROGRESS }],
      ['done', { status: TaskStatus.COMPLETED }],
      ['with a link proof', { proof_link: 'https://x.test' }],
    ])('keeps an open copy that is %s', async (_label, over) => {
      repo.findLatestSeriesCopy.mockResolvedValue(copy(over));

      const result = await service.delete('open', 'ch-1');

      expect(tasks.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted_task_id: null });
    });

    it('keeps a latest copy that is already overdue', async () => {
      repo.findSeries.mockResolvedValue([
        { ...SERIES, ended_at: '2026-11-10T00:00:00.000Z' },
      ]);
      repo.findLatestSeriesCopy.mockResolvedValue(
        copy({
          due_date: '2026-11-09',
          due_at: '2026-11-10T02:00:00.000Z',
          occurrence_date: '2026-11-09',
        }),
      );

      const result = await service.delete('open', 'ch-1');

      expect(tasks.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted_task_id: null });
    });

    it('keeps an open copy with a checked step or a proof photo', async () => {
      repo.hasCheckedSubtask.mockResolvedValueOnce(true);
      await service.delete('open', 'ch-1');
      repo.findPhotos.mockResolvedValueOnce([{ kind: 'proof' } as never]);
      await service.delete('open', 'ch-1');

      expect(tasks.delete).not.toHaveBeenCalled();
    });

    it('retries when the sweep made a copy between the read and the end', async () => {
      repo.updateSeriesIfNext
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(SERIES);

      await service.delete('open', 'ch-1');

      expect(repo.updateSeriesIfNext).toHaveBeenCalledTimes(2);
      expect(tasks.delete).toHaveBeenCalledTimes(1);
    });

    it('is a 404 for a missing task and a 400 for one that does not repeat', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(service.delete('x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      repo.findById.mockResolvedValueOnce(copy({ series_id: null }));
      await expect(service.delete('x', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
