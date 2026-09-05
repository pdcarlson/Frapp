import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { Task, TaskStatus } from '#domain/entities/task.entity';
import type { Member } from '#domain/entities/member.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';

describe('TaskService', () => {
  let service: TaskService;
  let mockTaskRepo: jest.Mocked<ITaskRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockUserRepo: jest.Mocked<Pick<IUserRepository, 'findByIds'>>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockChatService: jest.Mocked<Pick<ChatService, 'sendMessage'>>;

  const baseTask: Task = {
    id: 'task-1',
    chapter_id: 'ch-1',
    title: 'Test Task',
    description: 'Test description',
    assignee_id: 'user-1',
    created_by: 'admin-1',
    due_date: '2099-03-15',
    status: TaskStatus.TODO,
    point_reward: 10,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  /**
   * A task as the read paths return it (#1051). `create` deliberately does not
   * go through `toDisplayStatus`, which is why its assertions still compare
   * against the bare entity.
   */
  const asView = (task: Task) => ({ ...task, stored_status: task.status });

  const baseMember: Member = {
    id: 'member-1',
    user_id: 'user-1',
    chapter_id: 'ch-1',
    role_ids: ['role-1'],
    custom_role_ids: [],
    has_completed_onboarding: true,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockTaskRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByAssignee: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      confirmCompletionAtomic: jest.fn(),
      delete: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockUserRepo = {
      findByIds: jest.fn().mockResolvedValue([]),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockChatService = {
      sendMessage: jest.fn().mockResolvedValue({
        message: { id: 'msg-1' },
        deduplicated: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: TASK_REPOSITORY, useValue: mockTaskRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ChatService, useValue: mockChatService },
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
        due_date: '2099-03-15',
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
        due_date: '2099-03-15',
        status: TaskStatus.TODO,
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
          due_date: '2099-03-15',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
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

    it('posts a server-originated task card when channel + client_message_id are set', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);
      mockUserRepo.findByIds.mockResolvedValue([
        { id: 'admin-1', display_name: 'Admin Alice' },
        { id: 'user-1', display_name: 'Member Bob' },
      ]);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        point_reward: 10,
        channel_id: 'channel-1',
        client_message_id: 'cmid-1',
      });

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          channel_id: 'channel-1',
          sender_id: 'admin-1',
          kind: 'task',
          system_originated: true,
          client_message_id: 'cmid-1',
          payload: expect.objectContaining({
            task_id: 'task-1',
            title: 'Test Task',
            assigner_name: 'Admin Alice',
            assignee_name: 'Member Bob',
            status: 'TODO',
            point_reward: 10,
          }),
        }),
      );
    });

    it('does not post a card for a dashboard create (no channel)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
      });

      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns the created task even if the card post fails (best-effort)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);
      mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

      const result = await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        channel_id: 'channel-1',
        client_message_id: 'cmid-1',
      });

      expect(result).toEqual(baseTask);
    });
  });

  describe('updateStatus', () => {
    it('should allow TODO → IN_PROGRESS transition', async () => {
      const updated: Task = { ...baseTask, status: TaskStatus.IN_PROGRESS };
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.update.mockResolvedValue(updated);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.IN_PROGRESS,
      );

      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({ status: TaskStatus.IN_PROGRESS }),
      );
      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should allow IN_PROGRESS → COMPLETED transition', async () => {
      const inProgress: Task = { ...baseTask, status: TaskStatus.IN_PROGRESS };
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(inProgress);
      mockTaskRepo.update.mockResolvedValue(completed);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
      );

      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({
          status: TaskStatus.COMPLETED,
          completed_at: expect.any(String),
        }),
      );
      expect(result.status).toBe(TaskStatus.COMPLETED);
    });

    it('should reject invalid transition TODO → COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        ),
      ).rejects.toThrow('Invalid status transition from TODO to COMPLETED');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject invalid transition TODO → OVERDUE', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.OVERDUE,
        ),
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
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'other-user',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow('Only the assignee or an admin can update task status');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow('Task not found');
    });
  });

  describe('confirmCompletion', () => {
    it('should confirm completion with points via the atomic RPC', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion(
        'task-1',
        'ch-1',
        'admin-1',
      );

      // The confirm + ledger insert now happen in one DB transaction, so the
      // service delegates to the RPC and never issues separate writes.
      expect(mockTaskRepo.confirmCompletionAtomic).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
      );
      expect(mockTaskRepo.update).not.toHaveBeenCalled();
      expect(result.points_awarded).toBe(true);
    });

    it('should confirm completion without points (no point_reward)', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        point_reward: null,
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion(
        'task-1',
        'ch-1',
        'admin-1',
      );

      expect(mockTaskRepo.confirmCompletionAtomic).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
      );
      expect(result.points_awarded).toBe(true);
    });

    it('should prevent double point award (fast-path guard)', async () => {
      const alreadyConfirmed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(alreadyConfirmed);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow('Points have already been awarded for this task');

      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });

    it('should reject when the atomic confirm awards nothing (lost race)', async () => {
      // findById sees an un-awarded task, but a concurrent confirm flips
      // points_awarded first, so the compare-and-set updates 0 rows (null).
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(null);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow('no longer eligible or points were already awarded');
    });

    it('refuses a self-confirmation, mirroring adjustPoints (#1056)', async () => {
      // The assignee is `user-1`, and here `user-1` is also the caller: an
      // officer holding `tasks:manage` who assigned a task to themselves,
      // marked it COMPLETED, and is now confirming it. Confirming would insert
      // `point_reward` into their own ledger with no second party — exactly
      // what `PointsService.adjustPoints` refuses for `points:adjust`.
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(completed);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('Admins cannot confirm their own task completions');

      // The ledger must not move. Refusing after the award would be no refusal
      // at all, so this assertion is the actual point of the test.
      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });

    it('refuses a self-confirmation before the status guard', async () => {
      // A self-confirm on a task that is not COMPLETED must still read as
      // Forbidden, not BadRequest: which refusal a caller sees must not depend
      // on what state their own task happens to be in.
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });

    it('still allows a different admin to confirm', async () => {
      // The guard keys on the assignee, not on "is an admin involved" — the
      // ordinary two-party path must stay open.
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion(
        'task-1',
        'ch-1',
        'some-other-officer',
      );

      expect(mockTaskRepo.confirmCompletionAtomic).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
      );
      expect(result.points_awarded).toBe(true);
    });

    it('should reject confirmation when task not COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(
        'Task must be marked COMPLETED by assignee before confirmation',
      );

      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });
  });

  describe('rejectCompletion', () => {
    it('should reject completion and revert to IN_PROGRESS', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const reverted: Task = {
        ...completed,
        status: TaskStatus.IN_PROGRESS,
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
        status: TaskStatus.IN_PROGRESS,
        completed_at: null,
      });
      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should reject when task already has points awarded', async () => {
      const confirmed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
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
      expect(result[0]).toEqual(asView(baseTask));
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
      expect(result[0]).toEqual(asView(baseTask));
    });

    it('should display OVERDUE status for past-due tasks', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      const overdueTask: Task = {
        ...baseTask,
        status: TaskStatus.TODO,
        due_date: pastDue.toISOString().slice(0, 10),
      };
      mockTaskRepo.findByChapter.mockResolvedValue([overdueTask]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe(TaskStatus.OVERDUE);
    });

    /**
     * The point of `stored_status` (#1051): `OVERDUE` collapses TODO and
     * IN_PROGRESS into one indistinct rendered value, and the transition table
     * is checked against the stored one. Without this field a client cannot
     * tell which transition is legal, so it cannot offer the assignee any
     * action on an overdue task at all.
     */
    it('carries the stored status alongside a derived OVERDUE', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      const dueDate = pastDue.toISOString().slice(0, 10);
      mockTaskRepo.findByChapter.mockResolvedValue([
        { ...baseTask, id: 'a', status: TaskStatus.TODO, due_date: dueDate },
        {
          ...baseTask,
          id: 'b',
          status: TaskStatus.IN_PROGRESS,
          due_date: dueDate,
        },
      ]);

      const result = await service.list('ch-1', 'user-1', true);

      // Both render identically...
      expect(result.map((t) => t.status)).toEqual([
        TaskStatus.OVERDUE,
        TaskStatus.OVERDUE,
      ]);
      // ...and are told apart only by the stored value.
      expect(result.map((t) => t.stored_status)).toEqual([
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
      ]);
    });

    // The guard the ternary rewrite could silently lose. Without this, dropping
    // the `TODO || IN_PROGRESS` term keeps every other test green, and a
    // COMPLETED task past its due date would render OVERDUE — grouping into the
    // wrong board column and hiding Confirm, so its points are never awarded.
    it('never derives OVERDUE for a COMPLETED task past its due date', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      mockTaskRepo.findByChapter.mockResolvedValue([
        {
          ...baseTask,
          status: TaskStatus.COMPLETED,
          due_date: pastDue.toISOString().slice(0, 10),
        },
      ]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe(TaskStatus.COMPLETED);
      expect(result[0].stored_status).toBe(TaskStatus.COMPLETED);
    });

    it('reports stored_status unchanged when nothing is derived', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([
        { ...baseTask, status: TaskStatus.COMPLETED },
      ]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe(TaskStatus.COMPLETED);
      expect(result[0].stored_status).toBe(TaskStatus.COMPLETED);
    });
  });

  describe('findById', () => {
    it('should return task by id', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      const result = await service.findById('task-1', 'ch-1');

      expect(mockTaskRepo.findById).toHaveBeenCalledWith('task-1', 'ch-1');
      expect(result).toEqual(asView(baseTask));
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
        due_date: '2099-03-15',
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
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      await service.confirmCompletion('task-1', 'ch-1', 'admin-1');

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

    // #358: the creator is notified so a completed task doesn't strand
    // waiting for a manual board check — mirrors the OVERDUE sweep's
    // "notify the creator, not every tasks:manage holder" rule.
    describe('task completion (#358)', () => {
      const creatorMember: Member = {
        ...baseMember,
        id: 'member-admin',
        user_id: 'admin-1',
      };
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };

      it("notifies the task's creator when the assignee marks it completed", async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.update.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(creatorMember);

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1', // the assignee
          false,
          TaskStatus.COMPLETED,
        );

        expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
          'admin-1', // task.created_by
          'ch-1',
        );
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({
            title: 'Task Completed',
            priority: 'NORMAL',
            category: 'tasks',
            data: { target: { screen: 'tasks', taskId: 'task-1' } },
          }),
        );
      });

      it("notifies the creator when an admin marks a task completed on the assignee's behalf", async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.update.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(creatorMember);

        await service.updateStatus(
          'task-1',
          'ch-1',
          'other-admin', // a different tasks:manage holder, not the creator
          true,
          TaskStatus.COMPLETED,
        );

        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({ title: 'Task Completed' }),
        );
      });

      it('does not notify when the creator is the one who completed their own task', async () => {
        const selfAssigned: Task = {
          ...baseTask,
          assignee_id: 'admin-1',
          created_by: 'admin-1',
          status: TaskStatus.IN_PROGRESS,
        };
        mockTaskRepo.findById.mockResolvedValue(selfAssigned);
        mockTaskRepo.update.mockResolvedValue({
          ...selfAssigned,
          status: TaskStatus.COMPLETED,
        });

        await service.updateStatus(
          'task-1',
          'ch-1',
          'admin-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('does not notify a creator who has since left the chapter', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.update.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('does not notify for a transition other than COMPLETED', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.update.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('returns the completed task even when the notification provider fails (best-effort)', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.update.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(creatorMember);
        mockNotificationService.notifyUser.mockRejectedValueOnce(
          new Error('push provider down'),
        );

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(result.status).toBe(TaskStatus.COMPLETED);
        expect(mockTaskRepo.update).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({ status: TaskStatus.COMPLETED }),
        );
      });

      it('returns the completed task even when the creator-membership lookup itself throws', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.update.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockRejectedValueOnce(
          new Error('connection pool exhausted'),
        );

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(result.status).toBe(TaskStatus.COMPLETED);
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });
    });
  });
});
