import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TaskService, type CreateTaskInput } from './task.service';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import {
  Task,
  TaskStatus,
  type TaskPhoto,
  type TaskPhotoKind,
} from '#domain/entities/task.entity';
import type { Member } from '#domain/entities/member.entity';
import type { User } from '#domain/entities/user.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  TASK_PROOF_REQUIRED_CODE,
  TASK_RESUBMIT_NEEDS_CHANGE_CODE,
} from '@repo/validation';
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
  let mockStorage: jest.Mocked<
    Pick<
      IStorageProvider,
      | 'getSignedUploadUrl'
      | 'getSignedDownloadUrl'
      | 'listFiles'
      | 'deleteFiles'
    >
  >;

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
    proof_kind: 'none',
    proof_link: null,
    sent_back_reason: null,
    completion_note: null,
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
      updateIfMatches: jest.fn(),
      confirmCompletionAtomic: jest.fn(),
      reopenCompletion: jest.fn(),
      delete: jest.fn(),
      findSubtasks: jest.fn().mockResolvedValue([]),
      createSubtasks: jest.fn().mockResolvedValue([]),
      setSubtaskDone: jest.fn(),
      deleteSubtask: jest.fn(),
      updateUnconfirmed: jest.fn(),
      releaseReminderClaims: jest.fn().mockResolvedValue(undefined),
      isPhotoPathInUse: jest.fn().mockResolvedValue(false),
      findPhotos: jest.fn().mockResolvedValue([]),
      createPhotos: jest.fn().mockResolvedValue([]),
      deletePhotos: jest.fn().mockResolvedValue([]),
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

    mockStorage = {
      getSignedUploadUrl: jest.fn().mockResolvedValue('https://upload'),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://view'),
      listFiles: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn().mockResolvedValue(undefined),
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
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
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
        proof_kind: 'none',
        completed_at: null,
        confirmed_at: null,
      });
      expect(result).toEqual({ ...baseTask, photos: [] });
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

      expect(result).toEqual({
        ...baseTask,
        photos: [],
        card_posted: false,
      });
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

        expect(result).toEqual({
          ...baseTask,
          photos: [],
          card_posted: true,
        });
      });

      it('reports card_posted: false when the card post throws', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
        mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

        const result = await service.create(chatInput);

        expect(result).toEqual({
          ...baseTask,
          photos: [],
          card_posted: false,
        });
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

        expect(result).toEqual({ ...baseTask, photos: [] });
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
      mockTaskRepo.updateIfMatches.mockResolvedValue(completed);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
      );

      expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.anything(),
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
          {
            expectedCompletedAt: '2026-02-26T18:30:00.000Z',
            pointsAwarded: false,
          },
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

    it('should confirm a completion without points that needed proof', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        point_reward: null,
        proof_kind: 'photo',
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
        {
          sentBackAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          sentBackReason: 'Needs more work',
          expectedCompletedAt: '2026-02-26T18:30:00.000Z',
          pointsAwarded: false,
        },
      );
      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      // The push carries the reason (#4635).
      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'An officer sent back: Test Task',
          body: '"Needs more work"',
        }),
      );
    });

    it.each([undefined, null, '', '   '])(
      'refuses a send-back with no reason (%p)',
      async (comment) => {
        await expect(
          service.rejectCompletion('task-1', 'ch-1', comment),
        ).rejects.toThrow('Say what needs to change to send it back');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      },
    );

    it('refuses a reason over 200 characters', async () => {
      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'x'.repeat(201)),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
    });

    it('stores the trimmed reason, and "ask for a photo" raises the proof kind', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.IN_PROGRESS,
        proof_kind: 'photo',
      });

      await service.rejectCompletion('task-1', 'ch-1', '  Blurry  ', {
        requirePhoto: true,
      });

      expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({
          sentBackReason: 'Blurry',
          proofKind: 'photo',
        }),
      );
    });

    it('sends back a task that needed no sign-off, though it reads confirmed', async () => {
      // No points, no proof: confirmed as it was marked done (#4635).
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        point_reward: null,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T18:30:00.000Z',
        points_awarded: true,
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue({
        ...baseTask,
        point_reward: null,
        status: TaskStatus.IN_PROGRESS,
      });

      await service.rejectCompletion('task-1', 'ch-1', 'Not finished');

      expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({ pointsAwarded: true }),
      );
    });

    it('refuses when a confirm lands between the guard and the write', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue(null);

      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(BadRequestException);
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

      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(
        'Cannot reject a task that has already been confirmed and points awarded',
      );

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject when task is not COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow('Only completed tasks can be rejected');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should list tasks by chapter when admin', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {});
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ...asView(baseTask),
        photos: [],
        subtasks: [],
      });
    });

    it('should list tasks by assignee when not admin', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', false);

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        assigneeId: 'user-1',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ...asView(baseTask),
        photos: [],
        subtasks: [],
      });
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
      expect(result).toEqual({
        ...asView(baseTask),
        photos: [],
        subtasks: [],
      });
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
          sent_back_reason: null,
          proof_link: null,
          completion_note: null,
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
          title: 'An officer confirmed: Test Task',
          body: '+10 points',
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
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
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
            title: 'A member submitted: Test Task',
            body: 'Confirm to award 10 points',
            priority: 'NORMAL',
            category: 'tasks',
            threadId: 'tasks:review',
            data: {
              target: { screen: 'tasks', taskId: 'task-1', view: 'review' },
            },
          }),
        );
      });

      it("notifies the creator when an admin marks a task completed on the assignee's behalf", async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
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
          expect.objectContaining({ title: 'A member submitted: Test Task' }),
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
        mockTaskRepo.updateIfMatches.mockResolvedValue({
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
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
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
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
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
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({ status: TaskStatus.COMPLETED }),
        );
      });

      it('returns the completed task even when the creator-membership lookup itself throws', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
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
  describe('photos and proof kinds (#4565, #4635)', () => {
    const REF = 'chapters/ch-1/tasks/p1/mess.jpg';
    const PROOF = 'chapters/ch-1/tasks/p2/done.jpg';
    const uploaded = (...paths: string[]) =>
      mockStorage.listFiles.mockResolvedValue(paths);
    const photo = (
      id: string,
      kind: TaskPhotoKind,
      storage_path: string,
      position = 0,
    ): TaskPhoto => ({
      id,
      task_id: 'task-1',
      chapter_id: 'ch-1',
      kind,
      storage_path,
      position,
      created_by: 'user-1',
      created_at: '2026-02-26T00:00:00.000Z',
    });
    const inProgress = (overrides: Partial<Task> = {}): Task => ({
      ...baseTask,
      status: TaskStatus.IN_PROGRESS,
      ...overrides,
    });
    const markDone = (
      completion?: Parameters<TaskService['updateStatus']>[5],
    ) =>
      service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
        completion,
      );
    const refusalOf = async (promise: Promise<unknown>) => {
      const error = await promise.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse();
    };

    it('mints an upload URL under the chapter tasks prefix, photos only', async () => {
      const ticket = await service.requestPhotoUploadUrl({
        chapterId: 'CH-1',
        filename: 'mess.jpg',
        contentType: 'image/jpeg',
      });
      expect(ticket.storagePath).toMatch(
        /^chapters\/ch-1\/tasks\/[0-9a-f-]+\/mess\.jpg$/,
      );
      expect(mockStorage.getSignedUploadUrl).toHaveBeenCalledWith(
        'tasks',
        ticket.storagePath,
        'image/jpeg',
      );
      await expect(
        service.requestPhotoUploadUrl({
          chapterId: 'ch-1',
          filename: 'slip.pdf',
          contentType: 'application/pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('create', () => {
      const createWith = (extra: Partial<CreateTaskInput>) =>
        service.create({
          chapter_id: 'ch-1',
          title: 'Clean',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
          ...extra,
        });

      beforeEach(() => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
      });

      it('inserts checked, de-duplicated reference photos after the task, with the proof kind', async () => {
        const SECOND = 'chapters/ch-1/tasks/p3/b.jpg';
        uploaded(REF, SECOND);
        const rows = [photo('ph-1', 'reference', REF)];
        mockTaskRepo.createPhotos.mockResolvedValue(rows);

        const result = await createWith({
          reference_photo_paths: [REF, ` ${REF} `, SECOND],
          proof_kind: 'photo',
        });

        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ proof_kind: 'photo' }),
        );
        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([
          expect.objectContaining({
            task_id: 'task-1',
            kind: 'reference',
            storage_path: REF,
            position: 0,
            created_by: 'admin-1',
          }),
          expect.objectContaining({ storage_path: SECOND, position: 1 }),
        ]);
        expect(mockTaskRepo.create.mock.invocationCallOrder[0]).toBeLessThan(
          mockTaskRepo.createPhotos.mock.invocationCallOrder[0],
        );
        expect(result.photos).toEqual(rows);
      });

      it('defaults the proof kind to none and inserts no photo rows', async () => {
        const result = await createWith({});
        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ proof_kind: 'none' }),
        );
        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(result.photos).toEqual([]);
      });

      it('keeps the task when the photo insert fails', async () => {
        uploaded(REF);
        mockTaskRepo.createPhotos.mockRejectedValue(new Error('db down'));
        const result = await createWith({ reference_photo_paths: [REF] });
        expect(result.id).toBe('task-1');
        expect(result.photos).toEqual([]);
      });

      it('refuses a 7th reference photo', async () => {
        const paths = Array.from(
          { length: 7 },
          (_, i) => `chapters/ch-1/tasks/p${i}/x.jpg`,
        );
        uploaded(...paths);
        await expect(
          createWith({ reference_photo_paths: paths }),
        ).rejects.toThrow('at most 6');
        expect(mockTaskRepo.create).not.toHaveBeenCalled();
      });

      it.each([
        ['another chapter', 'chapters/ch-2/tasks/p1/mess.jpg', []],
        [
          'a climb out of the prefix',
          'chapters/ch-1/tasks/../service/x.jpg',
          [],
        ],
        ['nothing uploaded', REF, []],
      ])('refuses a reference photo from %s', async (_, path, objects) => {
        uploaded(...objects);
        await expect(
          createWith({ reference_photo_paths: [path] }),
        ).rejects.toThrow(BadRequestException);
        expect(mockTaskRepo.create).not.toHaveBeenCalled();
      });

      it('refuses a path another photo already holds', async () => {
        uploaded(REF);
        mockTaskRepo.isPhotoPathInUse.mockResolvedValue(true);
        await expect(
          createWith({ reference_photo_paths: [REF] }),
        ).rejects.toThrow('already attached');
      });
    });

    describe('Mark done', () => {
      it('refuses a Photo task without photos, by code', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        expect(await refusalOf(markDone())).toMatchObject({
          code: TASK_PROOF_REQUIRED_CODE,
        });
        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('refuses a Link task without a link, by code', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'link' }),
        );
        expect(await refusalOf(markDone({ proof_link: '  ' }))).toMatchObject({
          code: TASK_PROOF_REQUIRED_CODE,
        });
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it.each(['javascript:alert(1)', 'not a link', 'ftp://example.com/x'])(
        'refuses an invalid link (%s)',
        async (link) => {
          mockTaskRepo.findById.mockResolvedValue(
            inProgress({ proof_kind: 'link' }),
          );
          await expect(markDone({ proof_link: link })).rejects.toThrow(
            'proof_link must be a web link',
          );
          expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
        },
      );

      it('stores a Link task’s trimmed link with the completion', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'link' }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_link: ' https://docs.example.com/x ' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({
            status: TaskStatus.COMPLETED,
            proof_link: 'https://docs.example.com/x',
            completion_note: null,
          }),
        );
      });

      it('refuses a 7th proof photo', async () => {
        const paths = Array.from(
          { length: 7 },
          (_, i) => `chapters/ch-1/tasks/q${i}/x.jpg`,
        );
        uploaded(...paths);
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        await expect(markDone({ proof_photo_paths: paths })).rejects.toThrow(
          'at most 6',
        );
        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('inserts the proof rows before the task moves, and returns them', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(PROOF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          proof_kind: 'photo',
          status: TaskStatus.COMPLETED,
        });
        mockTaskRepo.findPhotos.mockResolvedValue([proofRow]);

        const result = await markDone({ proof_photo_paths: [PROOF] });

        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([
          expect.objectContaining({
            kind: 'proof',
            storage_path: PROOF,
            position: 0,
            created_by: 'user-1',
          }),
        ]);
        expect(
          mockTaskRepo.createPhotos.mock.invocationCallOrder[0],
        ).toBeLessThan(
          mockTaskRepo.updateIfMatches.mock.invocationCallOrder[0],
        );
        expect(result.photos).toEqual([proofRow]);
      });

      it('deletes the proof rows again when the task update throws', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(PROOF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.updateIfMatches.mockRejectedValue(new Error('db down'));

        await expect(markDone({ proof_photo_paths: [PROOF] })).rejects.toThrow(
          'db down',
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });

      it.each([
        ['another chapter', 'chapters/ch-2/tasks/p2/done.jpg', true],
        ['nothing uploaded', PROOF, false],
      ])('refuses a proof photo from %s', async (_, path, uploadedIt) => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(...(uploadedIt ? [path] : []));
        await expect(markDone({ proof_photo_paths: [path] })).rejects.toThrow(
          BadRequestException,
        );
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('refuses as proof a photo another task holds', async () => {
        mockTaskRepo.findById.mockResolvedValue(inProgress());
        uploaded(PROOF);
        mockTaskRepo.isPhotoPathInUse.mockResolvedValue(true);
        await expect(markDone({ proof_photo_paths: [PROOF] })).rejects.toThrow(
          'already attached',
        );
      });

      it('refuses a sent-back task marked done again with nothing new', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            sent_back_at: '2026-02-27T00:00:00.000Z',
            sent_back_reason: 'Blurry',
          }),
        );
        expect(await refusalOf(markDone())).toMatchObject({
          code: TASK_RESUBMIT_NEEDS_CHANGE_CODE,
        });
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('takes a sent-back task back with a reply', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ sent_back_at: '2026-02-27T00:00:00.000Z' }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ completion_note: '  Fixed the corner  ' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({ completion_note: 'Fixed the corner' }),
        );
      });

      it('marks a points task with no proof done, waiting on sign-off', async () => {
        mockTaskRepo.findById.mockResolvedValue(inProgress());
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        await markDone();
        const patch = mockTaskRepo.updateIfMatches.mock.calls[0][3];
        expect(patch).not.toHaveProperty('confirmed_at');
        expect(patch).not.toHaveProperty('points_awarded');
        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([]);
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({
            body: 'Confirm to award 10 points',
          }),
        );
      });

      it('signs off at once a task with no points and no proof, and the push asks nothing', async () => {
        const free = inProgress({ point_reward: null });
        mockTaskRepo.findById.mockResolvedValue(free);
        mockTaskRepo.updateIfMatches.mockImplementation(
          (_id, _ch, _match, patch) => Promise.resolve({ ...free, ...patch }),
        );
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);

        const result = await markDone();

        const patch = mockTaskRepo.updateIfMatches.mock.calls[0][3];
        expect(patch.points_awarded).toBe(true);
        expect(patch.confirmed_at).toBe(patch.completed_at);
        expect(result.points_awarded).toBe(true);
        const push = mockNotificationService.notifyUser.mock.calls[0][2];
        expect(push.title).toBe('A member finished: Test Task');
        expect(push.body).toBe("Done · send it back if something's off");
      });

      it('compare-and-sets on the status, points and proof kind it judged', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ point_reward: null, proof_kind: 'link' }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_link: 'https://example.com/x' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          {
            status: TaskStatus.IN_PROGRESS,
            point_reward: null,
            proof_kind: 'link',
          },
          expect.objectContaining({ status: TaskStatus.COMPLETED }),
        );
        expect(mockTaskRepo.update).not.toHaveBeenCalled();
      });

      it('a lost compare-and-set refuses with 400 and drops the proof rows it inserted', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(PROOF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.updateIfMatches.mockResolvedValue(null);

        await expect(markDone({ proof_photo_paths: [PROOF] })).rejects.toThrow(
          'This task changed while you were marking it done',
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('takes a sent-back Link task back with only a new link', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            proof_kind: 'link',
            sent_back_at: '2026-02-27T00:00:00.000Z',
            sent_back_reason: 'Wrong doc',
          }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_link: 'https://docs.example.com/right' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({
            proof_link: 'https://docs.example.com/right',
            completion_note: null,
          }),
        );
      });

      it('takes a sent-back Photo task back with only new photos', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            proof_kind: 'photo',
            sent_back_at: '2026-02-27T00:00:00.000Z',
            sent_back_reason: 'Blurry',
          }),
        );
        uploaded(PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([
          photo('ph-2', 'proof', PROOF),
        ]);
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_photo_paths: [PROOF] });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({
            status: TaskStatus.COMPLETED,
            proof_link: null,
            completion_note: null,
          }),
        );
      });
    });

    describe('reopening a completion', () => {
      const done = (overrides: Partial<Task> = {}): Task => ({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        ...overrides,
      });

      it('take-back reopens only the completion it read and deletes only its proof rows', async () => {
        mockTaskRepo.findById.mockResolvedValue(done());
        const ref = photo('ph-1', 'reference', REF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.findPhotos.mockResolvedValue([ref, proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.reopenCompletion.mockResolvedValue(
          inProgress({ completed_at: null }),
        );

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          {
            expectedCompletedAt: '2026-02-26T18:30:00.000Z',
            pointsAwarded: false,
          },
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });

      it('take-back reopens a task that needed no sign-off, though it reads confirmed', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({
            point_reward: null,
            confirmed_at: '2026-02-26T18:30:00.000Z',
            points_awarded: true,
          }),
        );
        mockTaskRepo.reopenCompletion.mockResolvedValue(
          inProgress({ point_reward: null }),
        );

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({ pointsAwarded: true }),
        );
      });

      it('take-back still refuses a task whose points were paid', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({ points_awarded: true, confirmed_at: '2026-02-27T00:00:00Z' }),
        );
        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'user-1',
            false,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow('stays done');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      });

      it('a send-back deletes the proof it read', async () => {
        mockTaskRepo.findById.mockResolvedValue(done());
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.findPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.reopenCompletion.mockResolvedValue(inProgress());

        await service.rejectCompletion('task-1', 'ch-1', 'Redo it');

        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });

      it('a lost compare-and-set deletes nothing', async () => {
        mockTaskRepo.findById.mockResolvedValue(done());
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-2', 'proof', PROOF),
        ]);
        mockTaskRepo.reopenCompletion.mockResolvedValue(null);

        await expect(
          service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
        ).rejects.toThrow(BadRequestException);
        expect(mockTaskRepo.deletePhotos).not.toHaveBeenCalled();
        expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
      });

      describe('an officer-confirmed task with no points (confirmed after it was done)', () => {
        const officerConfirmed = done({
          point_reward: null,
          points_awarded: true,
          confirmed_at: '2026-02-27T09:00:00.000Z',
        });

        it('take-back refuses it', async () => {
          mockTaskRepo.findById.mockResolvedValue(officerConfirmed);
          await expect(
            service.updateStatus(
              'task-1',
              'ch-1',
              'user-1',
              false,
              TaskStatus.IN_PROGRESS,
            ),
          ).rejects.toThrow('stays done');
          expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
        });

        it('send-back refuses it', async () => {
          mockTaskRepo.findById.mockResolvedValue(officerConfirmed);
          await expect(
            service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
          ).rejects.toThrow('already been confirmed');
          expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
        });
      });

      it('send-back reopens a task signed off automatically (same instant, other offset)', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({
            point_reward: null,
            points_awarded: true,
            completed_at: '2026-02-26T18:30:00.000Z',
            confirmed_at: '2026-02-26T18:30:00+00:00',
          }),
        );
        mockTaskRepo.reopenCompletion.mockResolvedValue(inProgress());

        await service.rejectCompletion('task-1', 'ch-1', 'Redo it');

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({ pointsAwarded: true }),
        );
      });

      it('confirm refuses a task that needs no sign-off', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({
            point_reward: null,
            confirmed_at: '2026-02-26T18:30:00.000Z',
            points_awarded: true,
          }),
        );
        await expect(
          service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
        ).rejects.toThrow("doesn't need an officer to confirm it");
        expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
      });
    });

    describe('edit', () => {
      const NEW = 'chapters/ch-1/tasks/p3/new.jpg';

      it('adds new reference photos after the held ones and removes missing ones', async () => {
        const KEEP = 'chapters/ch-1/tasks/p4/keep.jpg';
        const keep = photo('ph-1', 'reference', KEEP, 0);
        const gone = photo('ph-3', 'reference', REF, 1);
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.findPhotos.mockResolvedValue([keep, gone]);
        mockTaskRepo.deletePhotos.mockResolvedValue([gone]);
        // Only the new path is uploaded: a held one is not re-checked.
        uploaded(NEW);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue(baseTask);

        await service.update('task-1', 'ch-1', 'admin-1', {
          reference_photo_paths: [KEEP, NEW],
        });

        // A photos-only edit still goes through the compare-and-set.
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          { title: baseTask.title },
        );
        expect(mockTaskRepo.isPhotoPathInUse).toHaveBeenCalledTimes(1);
        expect(mockTaskRepo.isPhotoPathInUse).toHaveBeenCalledWith('ch-1', NEW);
        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([
          expect.objectContaining({
            kind: 'reference',
            storage_path: NEW,
            position: 2,
            created_by: 'admin-1',
          }),
        ]);
        expect(
          mockTaskRepo.updateUnconfirmed.mock.invocationCallOrder[0],
        ).toBeLessThan(mockTaskRepo.createPhotos.mock.invocationCallOrder[0]);
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-3'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [REF]);
      });

      it('removes every reference photo with []', async () => {
        const held = photo('ph-1', 'reference', REF);
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.findPhotos.mockResolvedValue([held]);
        mockTaskRepo.deletePhotos.mockResolvedValue([held]);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue(baseTask);

        await service.update('task-1', 'ch-1', 'admin-1', {
          reference_photo_paths: [],
        });

        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-1'],
        );
      });

      it('writes nothing when the reference set is unchanged', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-1', 'reference', REF),
        ]);
        await service.update('task-1', 'ch-1', 'admin-1', {
          reference_photo_paths: [REF],
        });
        expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
        expect(mockTaskRepo.deletePhotos).not.toHaveBeenCalled();
      });

      it('changes the proof kind', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue({
          ...baseTask,
          proof_kind: 'link',
        });
        await service.update('task-1', 'ch-1', 'admin-1', {
          proof_kind: 'link',
        });
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          { proof_kind: 'link' },
        );
      });

      it('reads no photos for an edit without photos or a new assignee', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue({
          ...baseTask,
          title: 'New',
        });
        await service.update('task-1', 'ch-1', 'admin-1', { title: 'New' });
        expect(mockTaskRepo.findPhotos).toHaveBeenCalledTimes(1);
        // The one read is the response's own (viewWithPhotos), after the write.
        expect(
          mockTaskRepo.updateUnconfirmed.mock.invocationCallOrder[0],
        ).toBeLessThan(mockTaskRepo.findPhotos.mock.invocationCallOrder[0]);
      });

      describe('a completion waiting on sign-off', () => {
        const waiting: Task = {
          ...baseTask,
          status: TaskStatus.COMPLETED,
          completed_at: '2026-02-26T18:30:00.000Z',
        };

        it('signs it off, stamped with its completion time, when an edit zeroes its points', async () => {
          mockTaskRepo.findById.mockResolvedValue(waiting);
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            point_reward: 0,
          });
          expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
            'task-1',
            'ch-1',
            {
              point_reward: null,
              confirmed_at: '2026-02-26T18:30:00.000Z',
              completed_at: '2026-02-26T18:30:00.000Z',
              points_awarded: true,
            },
          );
        });

        it('signs it off when an edit drops the last proof it needed', async () => {
          mockTaskRepo.findById.mockResolvedValue({
            ...waiting,
            point_reward: null,
            proof_kind: 'link',
          });
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            proof_kind: 'none',
          });
          expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
            'task-1',
            'ch-1',
            expect.objectContaining({
              proof_kind: 'none',
              points_awarded: true,
            }),
          );
        });

        it('leaves it waiting when the edit still leaves something to check', async () => {
          mockTaskRepo.findById.mockResolvedValue({
            ...waiting,
            proof_kind: 'photo',
          });
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            point_reward: 0,
          });
          const patch = mockTaskRepo.updateUnconfirmed.mock.calls[0][2];
          expect(patch).toEqual({ point_reward: null });
        });

        it('leaves it waiting when the edit touches neither points nor proof', async () => {
          mockTaskRepo.findById.mockResolvedValue({
            ...waiting,
            point_reward: null,
          });
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', { title: 'New' });
          expect(mockTaskRepo.updateUnconfirmed.mock.calls[0][2]).toEqual({
            title: 'New',
          });
        });

        it('hands it over instead of signing it off when it is also reassigned', async () => {
          mockTaskRepo.findById.mockResolvedValue(waiting);
          mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            point_reward: 0,
            assignee_id: 'user-2',
          });
          const patch = mockTaskRepo.updateUnconfirmed.mock.calls[0][2];
          expect(patch).toMatchObject({
            status: TaskStatus.TODO,
            completed_at: null,
          });
          expect(patch).not.toHaveProperty('confirmed_at');
          expect(patch).not.toHaveProperty('points_awarded');
        });
      });

      it('a hand-over drops the proof rows and clears the reason, link and reply', async () => {
        const ref = photo('ph-1', 'reference', REF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
          sent_back_at: '2026-02-27T00:00:00.000Z',
          sent_back_reason: 'Blurry',
          proof_link: 'https://example.com',
          completion_note: 'Done',
        });
        mockTaskRepo.findPhotos.mockResolvedValue([ref, proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue({
          ...baseTask,
          assignee_id: 'user-2',
        });

        await service.update('task-1', 'ch-1', 'admin-1', {
          assignee_id: 'user-2',
        });

        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({
            assignee_id: 'user-2',
            status: TaskStatus.TODO,
            completed_at: null,
            sent_back_at: null,
            sent_back_reason: null,
            proof_link: null,
            completion_note: null,
          }),
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });
    });

    it('delete releases every photo the task held, and a failed delete never fails it', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.findPhotos.mockResolvedValue([
        photo('ph-1', 'reference', REF),
        photo('ph-2', 'proof', PROOF),
      ]);
      mockStorage.deleteFiles.mockRejectedValue(new Error('storage down'));
      await expect(service.delete('task-1', 'ch-1')).resolves.toBeUndefined();
      expect(mockTaskRepo.delete).toHaveBeenCalled();
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [
        REF,
        PROOF,
      ]);
    });

    describe('getPhotoDownloadUrl', () => {
      it('signs one of the task’s photos by id', async () => {
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-1', 'reference', REF),
          photo('ph-2', 'proof', PROOF),
        ]);
        await expect(
          service.getPhotoDownloadUrl('task-1', 'ch-1', 'ph-2'),
        ).resolves.toEqual({ url: 'https://view' });
        expect(mockTaskRepo.findPhotos).toHaveBeenCalledWith('ch-1', [
          'task-1',
        ]);
        expect(mockStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
          'tasks',
          PROOF,
        );
      });

      it('404s a photo the task does not have', async () => {
        await expect(
          service.getPhotoDownloadUrl('task-1', 'ch-1', 'ph-9'),
        ).rejects.toThrow(NotFoundException);
        expect(mockStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
      });

      it('signs nothing outside the chapter', async () => {
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-1', 'proof', 'chapters/ch-2/tasks/p/x.jpg'),
        ]);
        await expect(
          service.getPhotoDownloadUrl('task-1', 'ch-1', 'ph-1'),
        ).rejects.toThrow(NotFoundException);
        expect(mockStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
      });
    });
  });
});
