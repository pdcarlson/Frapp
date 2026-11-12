import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
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
import type { User } from '#domain/entities/user.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';
import { memberFixture, userFixture } from '#test/helpers/entity-fixtures';

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
    due_at: null,
    status: TaskStatus.TODO,
    point_reward: 10,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    sent_back_at: null,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  /**
   * A task as the read paths return it (#1051). `create` deliberately does not
   * go through `toDisplayStatus`, which is why its assertions still compare
   * against the bare entity.
   */
  const asView = (task: Task) => ({ ...task, stored_status: task.status });

  const baseMember: Member = memberFixture({
    role_ids: ['role-1'],
    has_completed_onboarding: true,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  });

  beforeEach(async () => {
    mockTaskRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findSince: jest.fn(),
      countByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      confirmCompletionAtomic: jest.fn(),
      reopenCompletion: jest.fn(),
      delete: jest.fn(),
      findSubtasks: jest.fn().mockResolvedValue([]),
      createSubtasks: jest.fn().mockResolvedValue([]),
      setSubtaskDone: jest.fn(),
      deleteSubtask: jest.fn(),
      updateUnconfirmed: jest.fn(),
      releaseReminderClaims: jest.fn().mockResolvedValue(undefined),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByUser: jest.fn(),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
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
        due_at: null,
        status: TaskStatus.TODO,
        point_reward: 10,
        points_awarded: false,
        completed_at: null,
        confirmed_at: null,
      });
      expect(result).toEqual(baseTask);
    });

    it('adds the subtasks in order after the task (#4003)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Clean the kitchen',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        subtasks: [' Wipe the counters ', '', 'Mop the floor'],
      });

      expect(mockTaskRepo.createSubtasks).toHaveBeenCalledWith([
        {
          task_id: 'task-1',
          chapter_id: 'ch-1',
          title: 'Wipe the counters',
          position: 0,
        },
        {
          task_id: 'task-1',
          chapter_id: 'ch-1',
          title: 'Mop the floor',
          position: 1,
        },
      ]);
    });

    describe('with a due time (#4003)', () => {
      const create = (due_date: string, due_at: string) =>
        service.create({
          chapter_id: 'ch-1',
          title: 'Take out the trash',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date,
          due_at,
        });

      it('stores the instant beside the day', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue({
          ...baseTask,
          due_at: '2099-03-16T02:00:00.000Z',
        });
        (mockNotificationService as any).timeZoneFor = jest
          .fn()
          .mockResolvedValue('America/New_York');

        // 9 PM Central on Mar 15 is 02:00Z on Mar 16: still "on" Mar 15.
        await create('2099-03-15', '2099-03-15T21:00:00-05:00');

        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            due_date: '2099-03-15',
            due_at: '2099-03-16T02:00:00.000Z',
          }),
        );
        // The assignee reads the time in their own zone.
        const payload = mockNotificationService.notifyUser.mock.calls[0][2];
        expect(
          payload.personalize!({
            userId: 'user-1',
            timeZone: 'America/Chicago',
          }).body,
        ).toContain('due Sun, Mar 15, 2099, 9 PM');
      });

      it('refuses an instant that is not on the due day', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        await expect(
          create('2099-03-15', '2099-03-18T12:00:00.000Z'),
        ).rejects.toThrow('due_at must fall on due_date');
        expect(mockTaskRepo.create).not.toHaveBeenCalled();
      });
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
        {
          id: 'admin-1',
          display_name: 'Admin Alice',
        } as User,
        {
          id: 'user-1',
          display_name: 'Member Bob',
        } as User,
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

      expect(result).toEqual({ ...baseTask, card_posted: false });
    });

    // #1717: the client renders an optimistic `loading` placeholder keyed on
    // `client_message_id` and waits for the Realtime echo of the card to
    // reconcile it. A failed post means no echo ever arrives, so the caller
    // has to be told — otherwise the placeholder is permanent and an officer
    // cannot tell a committed create from a lost one.
    describe('card_posted (#1717)', () => {
      const chatInput = {
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        point_reward: 10,
        channel_id: 'channel-1',
        client_message_id: 'cmid-1',
      };

      it('reports card_posted: true when the card posts', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
        mockUserRepo.findByIds.mockResolvedValue([
          {
            id: 'admin-1',
            display_name: 'Admin Alice',
          } as User,
          {
            id: 'user-1',
            display_name: 'Member Bob',
          } as User,
        ]);

        const result = await service.create(chatInput);

        expect(result).toEqual({ ...baseTask, card_posted: true });
      });

      it('reports card_posted: false when the card post throws', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
        mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

        const result = await service.create(chatInput);

        expect(result).toEqual({ ...baseTask, card_posted: false });
      });

      it('omits card_posted entirely for a dashboard create', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);

        const result = await service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
        });

        expect(result).toEqual(baseTask);
        expect('card_posted' in result).toBe(false);
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      it('omits card_posted when only one half of the chat context is given', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);

        const result = await service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
          channel_id: 'channel-1',
        });

        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
        expect('card_posted' in result).toBe(false);
      });
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

    describe('the assignee taking back their own completion', () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };

      it('moves an unconfirmed completion back to IN_PROGRESS through the compare-and-set', async () => {
        mockTaskRepo.findById.mockResolvedValue(completed);
        mockTaskRepo.reopenCompletion.mockResolvedValue({
          ...completed,
          status: TaskStatus.IN_PROGRESS,
          completed_at: null,
        });

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
        );
        expect(mockTaskRepo.update).not.toHaveBeenCalled();
        expect(result.status).toBe(TaskStatus.IN_PROGRESS);
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('refuses once an officer has confirmed it', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...completed,
          points_awarded: true,
          confirmed_at: '2026-02-26T19:00:00.000Z',
        });

        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'user-1',
            false,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow('An officer already confirmed this task');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      });

      it('refuses when a confirm wins the race to the row', async () => {
        mockTaskRepo.findById.mockResolvedValue(completed);
        mockTaskRepo.reopenCompletion.mockResolvedValue(null);

        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'user-1',
            false,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it("still sends an officer moving someone else's completion to the reject endpoint", async () => {
        mockTaskRepo.findById.mockResolvedValue(completed);

        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'officer-1',
            true,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow('Use the reject completion endpoint');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      });
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
      mockTaskRepo.reopenCompletion.mockResolvedValue(reverted);

      const result = await service.rejectCompletion(
        'task-1',
        'ch-1',
        'Needs more work',
      );

      // Stamped with when it was sent back, which Activity reads as the
      // moment it waits on the assignee again.
      expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      );
      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('refuses when a confirm lands between the guard and the write', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue(null);

      await expect(service.rejectCompletion('task-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
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

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {});
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ ...asView(baseTask), subtasks: [] });
    });

    it('should list tasks by assignee when not admin', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', false);

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        assigneeId: 'user-1',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ ...asView(baseTask), subtasks: [] });
    });

    it('passes paging and filters through, and keeps a member to their own tasks', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([]);
      const after = { created_at: '2026-01-01T00:00:00+00:00', id: 'task-9' };

      await service.list('ch-1', 'user-1', false, {
        confirmed: true,
        after,
        limit: 50,
      });

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        confirmed: true,
        after,
        limit: 50,
        assigneeId: 'user-1',
      });
    });

    it('refuses a calendar-invalid cursor with a 400, not a database 500', async () => {
      await expect(
        service.list('ch-1', 'user-1', true, {
          after: { created_at: '2026-02-30T00:00:00Z', id: 'task-9' },
          limit: 50,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('counts in SQL, a member only their own', async () => {
      mockTaskRepo.countByChapter.mockResolvedValue(3);

      await expect(
        service.count('ch-1', 'user-1', false, { confirmed: false }),
      ).resolves.toBe(3);
      expect(mockTaskRepo.countByChapter).toHaveBeenCalledWith('ch-1', {
        confirmed: false,
        assigneeId: 'user-1',
      });
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

    it('is overdue from the minute of a due time, not the day after (#4003)', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const passed: Task = {
        ...baseTask,
        id: 'passed',
        due_date: today,
        due_at: new Date(Date.now() - 60_000).toISOString(),
      };
      const ahead: Task = {
        ...baseTask,
        id: 'ahead',
        due_date: today,
        due_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
      mockTaskRepo.findByChapter.mockResolvedValue([passed, ahead]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result.map((task) => task.status)).toEqual([
        TaskStatus.OVERDUE,
        TaskStatus.TODO,
      ]);
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
      expect(result).toEqual({ ...asView(baseTask), subtasks: [] });
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

  describe('update (#4296)', () => {
    it('changes only what differs and keeps the reminders when the due date stays', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...baseTask, ...patch }),
      );

      const result = await service.update('task-1', 'ch-1', 'admin-1', {
        title: '  Book the venue ',
        description: 'Test description',
        due_date: '2099-03-15',
        point_reward: 25,
      });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { title: 'Book the venue', point_reward: 25 },
      );
      expect(mockTaskRepo.releaseReminderClaims).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        title: 'Book the venue',
        point_reward: 25,
        stored_status: TaskStatus.TODO,
        subtasks: [],
      });
    });

    it('re-arms the reminders when a timed task moves within its day', async () => {
      const timed = {
        ...baseTask,
        due_at: '2099-03-15T21:00:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(timed);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...timed, ...patch }),
      );

      await service.update('task-1', 'ch-1', 'admin-1', {
        due_date: '2099-03-15',
        due_at: '2099-03-15T23:00:00-00:00',
      });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { due_at: '2099-03-15T23:00:00.000Z' },
      );
      expect(mockTaskRepo.releaseReminderClaims).toHaveBeenCalledWith(
        'ch-1',
        'task-1',
      );
    });

    it('takes a time off with due_at null', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        due_at: '2099-03-15T21:00:00.000Z',
      });
      mockTaskRepo.updateUnconfirmed.mockResolvedValue(baseTask);

      await service.update('task-1', 'ch-1', 'admin-1', { due_at: null });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { due_at: null },
      );
    });

    it('refuses a time that does not fall on the due date', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', {
          due_date: '2099-03-15',
          due_at: '2099-03-20T17:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
    });

    it('starts a reassigned task over and tells the new assignee', async () => {
      const waiting = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2099-03-14T12:00:00.000Z',
        sent_back_at: '2099-03-13T12:00:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(waiting);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...waiting, ...patch }),
      );

      const result = await service.update('task-1', 'ch-1', 'admin-1', {
        assignee_id: 'user-2',
      });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        {
          assignee_id: 'user-2',
          status: TaskStatus.TODO,
          completed_at: null,
          sent_back_at: null,
        },
      );
      expect(mockTaskRepo.releaseReminderClaims).toHaveBeenCalled();
      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'ch-1',
        expect.objectContaining({ title: 'Test Task' }),
      );
      expect(result.status).toBe(TaskStatus.TODO);
    });

    it('sends no push when the officer reassigns the task to themselves (#1340)', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...baseTask, ...patch }),
      );

      await service.update('task-1', 'ch-1', 'admin-1', {
        assignee_id: 'admin-1',
      });

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('refuses an assignee outside the chapter', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', {
          assignee_id: 'stranger',
        }),
      ).rejects.toThrow('Assignee must be a member of the chapter');
    });

    it('refuses a blank title', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: '   ' }),
      ).rejects.toThrow('A task needs a title');
    });

    it('refuses a confirmed task', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        points_awarded: true,
      });

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: 'New' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
    });

    it('refuses when a confirm lands between the read and the write', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.updateUnconfirmed.mockResolvedValue(null);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: 'New' }),
      ).rejects.toThrow('confirmed while you were editing');
    });

    it('404s a missing task', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('keeps the edit when releasing the reminders fails', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...baseTask, ...patch }),
      );
      mockTaskRepo.releaseReminderClaims.mockRejectedValue(new Error('down'));
      const report = jest
        .spyOn(caughtFailure, 'reportCaughtFailure')
        .mockImplementation(() => undefined);

      const result = await service.update('task-1', 'ch-1', 'admin-1', {
        due_date: '2099-03-20',
      });

      expect(result.due_date).toBe('2099-03-20');
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ site: 'task-edit-release-reminders' }),
      );
      report.mockRestore();
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
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'admin-1', display_name: 'Paul Carlson' }),
      ]);

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
          title: 'Test Task',
          body: 'From Paul Carlson · due Sun, Mar 15, 2099 · 10 points',
          priority: 'NORMAL',
          category: 'tasks',
        }),
      );
    });

    it('does not push a task someone assigns to themselves', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue({
        ...baseTask,
        assignee_id: 'admin-1',
      });

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'admin-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
      });

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
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
          title: 'Test Task',
          body: 'Confirmed · +10 points',
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
            title: 'Test Task',
            body: 'The assignee marked it done. Confirm it to award the points.',
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
          expect.objectContaining({ title: 'Test Task' }),
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
        const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(result.status).toBe(TaskStatus.COMPLETED);
        // Reported, not only logged (#4096).
        expect(reported).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ level: 'warning', site: 'task-notify' }),
        );
        reported.mockRestore();
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

  describe('subtasks (#4003)', () => {
    const subtask = {
      id: 'sub-1',
      task_id: 'task-1',
      chapter_id: 'ch-1',
      title: 'Mop the floor',
      position: 0,
      done_at: null,
      created_at: '2026-02-26T00:00:00.000Z',
    };

    it('lists each task with its own subtasks', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([
        baseTask,
        { ...baseTask, id: 'task-2' },
      ]);
      mockTaskRepo.findSubtasks.mockResolvedValue([subtask]);

      const result = await service.list('ch-1', 'admin-1', true);

      expect(mockTaskRepo.findSubtasks).toHaveBeenCalledWith('ch-1', [
        'task-1',
        'task-2',
      ]);
      expect(result.map((task) => task.subtasks)).toEqual([[subtask], []]);
    });

    it('lets the assignee check one off', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.setSubtaskDone.mockResolvedValue({
        ...subtask,
        done_at: 'now',
      });

      await service.setSubtaskDone(
        'task-1',
        'sub-1',
        'ch-1',
        'user-1',
        false,
        true,
      );

      expect(mockTaskRepo.setSubtaskDone).toHaveBeenCalledWith(
        'ch-1',
        'task-1',
        'sub-1',
        expect.any(String),
      );
    });

    it('refuses anyone else without tasks:manage', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      await expect(
        service.setSubtaskDone(
          'task-1',
          'sub-1',
          'ch-1',
          'user-9',
          false,
          true,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockTaskRepo.setSubtaskDone).not.toHaveBeenCalled();
    });

    it('keeps a confirmed task closed', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        points_awarded: true,
      });
      await expect(
        service.setSubtaskDone(
          'task-1',
          'sub-1',
          'ch-1',
          'user-1',
          false,
          false,
        ),
      ).rejects.toThrow('This task is already confirmed');
    });

    it('adds one at the end, up to the limit', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.findSubtasks.mockResolvedValue([
        subtask,
        { ...subtask, id: 'sub-2', position: 3 },
      ]);
      mockTaskRepo.createSubtasks.mockResolvedValue([subtask]);

      await service.addSubtask('task-1', 'ch-1', 'Take out the trash');

      expect(mockTaskRepo.createSubtasks).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Take out the trash', position: 4 }),
      ]);

      mockTaskRepo.findSubtasks.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ ...subtask, id: `s${i}` })),
      );
      await expect(
        service.addSubtask('task-1', 'ch-1', 'One more'),
      ).rejects.toThrow('up to 20 subtasks');
    });
  });
});
