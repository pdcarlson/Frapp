import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { TASK_REPOSITORY } from '../../domain/repositories/task.repository.interface';
import type { ITaskRepository } from '../../domain/repositories/task.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { Task } from '../../domain/entities/task.entity';
import type { Member } from '../../domain/entities/member.entity';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';
import { NotificationService } from './notification.service';

describe('TaskService', () => {
  let service: TaskService;
  let mockTaskRepo: jest.Mocked<ITaskRepository>;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;

  const baseTask: Task = {
    id: 'task-1',
    chapter_id: 'ch-1',
    title: 'Test Task',
    description: 'Test description',
    assignee_id: 'user-1',
    created_by: 'admin-1',
    due_date: '2030-03-15',
    status: 'TODO',
    point_reward: 10,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  const baseMember: Member = {
    id: 'member-1',
    user_id: 'user-1',
    chapter_id: 'ch-1',
    role_ids: ['role-1'],
    has_completed_onboarding: true,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  };

  const basePointTxn: PointTransaction = {
    id: 'pt-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    amount: 10,
    category: 'MANUAL',
    description: 'Task completed: Test Task',
    metadata: { task_id: 'task-1' },
    created_at: '2026-02-26T18:30:00.000Z',
  };

  beforeEach(async () => {
    mockTaskRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByAssignee: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockPointTxnRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: TASK_REPOSITORY, useValue: mockTaskRepo },
        { provide: POINT_TRANSACTION_REPOSITORY, useValue: mockPointTxnRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get(TaskService);
  });

  describe('create', () => {
    it('should create task successfully', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      const result = await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        description: 'Test description',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2030-03-15',
        point_reward: 10,
      });

      expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
      );
      expect(mockTaskRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        title: 'Test Task',
        description: 'Test description',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2030-03-15',
        status: 'TODO',
        point_reward: 10,
        points_awarded: false,
        completed_at: null,
        confirmed_at: null,
      });
      expect(result).toEqual(baseTask);
    });

    it('should reject create when assignee is not a chapter member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2030-03-15',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2030-03-15',
        }),
      ).rejects.toThrow('Assignee must be a member of the chapter');

      expect(mockTaskRepo.create).not.toHaveBeenCalled();
    });

    it('should reject invalid due_date', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);

      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: 'invalid-date',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should allow TODO → IN_PROGRESS transition', async () => {
      const updated: Task = { ...baseTask, status: 'IN_PROGRESS' };
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.update.mockResolvedValue(updated);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        'IN_PROGRESS',
      );

      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({ status: 'IN_PROGRESS' }),
      );
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should allow IN_PROGRESS → COMPLETED transition', async () => {
      const inProgress: Task = { ...baseTask, status: 'IN_PROGRESS' };
      const completed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(inProgress);
      mockTaskRepo.update.mockResolvedValue(completed);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        'COMPLETED',
      );

      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({
          status: 'COMPLETED',
          completed_at: expect.any(String),
        }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('should reject invalid transition TODO → COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus('task-1', 'ch-1', 'user-1', false, 'COMPLETED'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateStatus('task-1', 'ch-1', 'user-1', false, 'COMPLETED'),
      ).rejects.toThrow('Invalid status transition from TODO to COMPLETED');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject invalid transition TODO → OVERDUE', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus('task-1', 'ch-1', 'user-1', false, 'OVERDUE'),
      ).rejects.toThrow(BadRequestException);

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject non-assignee updating status without admin', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'other-user',
          false,
          'IN_PROGRESS',
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'other-user',
          false,
          'IN_PROGRESS',
        ),
      ).rejects.toThrow('Only the assignee or an admin can update task status');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus('task-1', 'ch-1', 'user-1', false, 'IN_PROGRESS'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateStatus('task-1', 'ch-1', 'user-1', false, 'IN_PROGRESS'),
      ).rejects.toThrow('Task not found');
    });
  });

  describe('confirmCompletion', () => {
    it('should confirm completion with points', async () => {
      const completed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);
      mockTaskRepo.update.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion('task-1', 'ch-1');

      expect(mockPointTxnRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        amount: 10,
        category: 'MANUAL',
        description: 'Task completed: Test Task',
        metadata: { task_id: 'task-1' },
      });
      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({
          confirmed_at: expect.any(String),
          points_awarded: true,
        }),
      );
      expect(result.points_awarded).toBe(true);
    });

    it('should confirm completion without points (no point_reward)', async () => {
      const completed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
        point_reward: null,
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.update.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion('task-1', 'ch-1');

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({
          confirmed_at: expect.any(String),
          points_awarded: true,
        }),
      );
      expect(result.points_awarded).toBe(true);
    });

    it('should prevent double point award', async () => {
      const alreadyConfirmed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(alreadyConfirmed);

      await expect(service.confirmCompletion('task-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmCompletion('task-1', 'ch-1')).rejects.toThrow(
        'Points have already been awarded for this task',
      );

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject confirmation when task not COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(service.confirmCompletion('task-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmCompletion('task-1', 'ch-1')).rejects.toThrow(
        'Task must be marked COMPLETED by assignee before confirmation',
      );

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('rejectCompletion', () => {
    it('should reject completion and revert to IN_PROGRESS', async () => {
      const completed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const reverted: Task = {
        ...completed,
        status: 'IN_PROGRESS',
        completed_at: null,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.update.mockResolvedValue(reverted);

      const result = await service.rejectCompletion(
        'task-1',
        'ch-1',
        'Needs more work',
      );

      expect(mockTaskRepo.update).toHaveBeenCalledWith('task-1', 'ch-1', {
        status: 'IN_PROGRESS',
        completed_at: null,
      });
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should reject when task already has points awarded', async () => {
      const confirmed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(confirmed);

      await expect(service.rejectCompletion('task-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.rejectCompletion('task-1', 'ch-1')).rejects.toThrow(
        'Cannot reject a task that has already been confirmed and points awarded',
      );

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject when task is not COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(service.rejectCompletion('task-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.rejectCompletion('task-1', 'ch-1')).rejects.toThrow(
        'Only completed tasks can be rejected',
      );

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should list tasks by chapter when admin', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(mockTaskRepo.findByAssignee).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(baseTask);
    });

    it('should list tasks by assignee when not admin', async () => {
      mockTaskRepo.findByAssignee.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', false);

      expect(mockTaskRepo.findByAssignee).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(mockTaskRepo.findByChapter).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(baseTask);
    });

    it('should display OVERDUE status for past-due tasks', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      const overdueTask: Task = {
        ...baseTask,
        status: 'TODO',
        due_date: pastDue.toISOString().slice(0, 10),
      };
      mockTaskRepo.findByChapter.mockResolvedValue([overdueTask]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe('OVERDUE');
    });
  });

  describe('listByChapter', () => {
    it('should return all tasks for chapter', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.listByChapter('ch-1');

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(result).toEqual([baseTask]);
    });
  });

  describe('listByAssignee', () => {
    it('should return tasks for assignee', async () => {
      mockTaskRepo.findByAssignee.mockResolvedValue([baseTask]);

      const result = await service.listByAssignee('ch-1', 'user-1');

      expect(mockTaskRepo.findByAssignee).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(result).toEqual([baseTask]);
    });
  });

  describe('findById', () => {
    it('should return task by id', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      const result = await service.findById('task-1', 'ch-1');

      expect(mockTaskRepo.findById).toHaveBeenCalledWith('task-1', 'ch-1');
      expect(result).toEqual(baseTask);
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(service.findById('task-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('task-1', 'ch-1')).rejects.toThrow(
        'Task not found',
      );
    });
  });

  describe('delete', () => {
    it('should delete task', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.delete.mockResolvedValue();

      await service.delete('task-1', 'ch-1');

      expect(mockTaskRepo.findById).toHaveBeenCalledWith('task-1', 'ch-1');
      expect(mockTaskRepo.delete).toHaveBeenCalledWith('task-1', 'ch-1');
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(service.delete('task-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockTaskRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('should notify assignee when task is created', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2030-03-15',
        point_reward: 10,
      });

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Task Assigned',
          priority: 'NORMAL',
          category: 'tasks',
        }),
      );
    });

    it('should notify assignee when task completion is confirmed', async () => {
      const completed: Task = {
        ...baseTask,
        status: 'COMPLETED',
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);
      mockTaskRepo.update.mockResolvedValue(confirmed);

      await service.confirmCompletion('task-1', 'ch-1');

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Task Confirmed',
          priority: 'NORMAL',
          category: 'tasks',
        }),
      );
    });
  });
});
