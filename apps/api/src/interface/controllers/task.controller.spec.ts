import { BadRequestException } from '@nestjs/common';
import { TaskStatus } from '#domain/entities/task.entity';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { TaskController } from './task.controller';
import { TaskService } from '../../application/services/task.service';
import { TaskSeriesService } from '../../application/services/task-series.service';
import { RbacService } from '../../application/services/rbac.service';
import { OpenTaskService } from '../../application/services/open-task.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CreateTaskDto,
  UpdateTaskStatusDto,
  RejectTaskCompletionDto,
} from '../dtos/task.dto';

const FOLLOWER = 'role:0f000000-0000-4000-8000-000000000001';

describe('TaskController', () => {
  let controller: TaskController;
  let taskService: jest.Mocked<TaskService>;
  let taskSeriesService: { update: jest.Mock; delete: jest.Mock };
  let rbacService: jest.Mocked<RbacService>;
  let openTaskService: { release: jest.Mock };

  beforeEach(async () => {
    taskService = {
      list: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      confirmCompletion: jest.fn(),
      rejectCompletion: jest.fn(),
      delete: jest.fn(),
      getPhotoDownloadUrl: jest.fn(),
      // Who may read a task (#5473): its assignee, an officer, or a member
      // of the group following it, here `role:followers`.
      mayRead: jest.fn((task, _chapterId, userId, isAdmin) =>
        Promise.resolve(
          isAdmin ||
            task.assignee_id === userId ||
            (userId === 'follower-1' && task.followed_by === FOLLOWER),
        ),
      ),
      asReadBy: jest.fn(TaskService.prototype.asReadBy),
      followEntriesOf: jest.fn().mockResolvedValue([]),
    } as any;

    taskSeriesService = { update: jest.fn(), delete: jest.fn() };

    rbacService = {
      memberHasAnyPermission: jest.fn(),
    } as any;
    openTaskService = { release: jest.fn() };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: TaskSeriesService, useValue: taskSeriesService },
        { provide: RbacService, useValue: rbacService },
        { provide: OpenTaskService, useValue: openTaskService },
      ],
    }).compile();

    controller = module.get<TaskController>(TaskController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('should list tasks and correctly identify admin status', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      rbacService.memberHasAnyPermission.mockResolvedValue(true);
      const mockTasks = [{ id: 'task-1' }] as any[];
      taskService.list.mockResolvedValue(mockTasks);

      const result = await controller.list(chapterId, userId, {});

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        chapterId,
        userId,
        [SystemPermissions.TASKS_MANAGE],
      );
      expect(taskService.list).toHaveBeenCalledWith(
        chapterId,
        userId,
        true,
        {},
        [],
      );
      expect(taskService.followEntriesOf).not.toHaveBeenCalled();
      expect(result).toBe(mockTasks);
    });

    it('should list tasks with false admin status if user lacks permission', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.list.mockResolvedValue([]);

      taskService.followEntriesOf.mockResolvedValue([FOLLOWER]);

      await controller.list(chapterId, userId, {});

      // A member's board also holds what their groups follow (#5473).
      expect(taskService.list).toHaveBeenCalledWith(
        chapterId,
        userId,
        false,
        {},
        [FOLLOWER],
      );
    });

    it('pages when asked, clamping the limit (#4037)', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      rbacService.memberHasAnyPermission.mockResolvedValue(true);
      taskService.list.mockResolvedValue([]);
      const before = '2026-01-01T00:00:00.123456+00:00';
      const beforeId = '0b000000-0000-4000-8000-000000000001';

      await controller.list(chapterId, userId, {
        limit: 200,
        before,
        before_id: beforeId,
      });
      await controller.list(chapterId, userId, { before, before_id: beforeId });

      // A cursor without a `limit` pages at the default 50.
      expect(taskService.list).toHaveBeenNthCalledWith(
        1,
        chapterId,
        userId,
        true,
        {
          after: { created_at: before, id: beforeId },
          limit: 200,
        },
        [],
      );
      expect(taskService.list).toHaveBeenNthCalledWith(
        2,
        chapterId,
        userId,
        true,
        {
          after: { created_at: before, id: beforeId },
          limit: 50,
        },
        [],
      );
    });
  });

  describe('getOne', () => {
    it('should get task if user is assignee', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const taskId = 'task-1';
      const mockTask = { id: taskId, assignee_id: userId } as any;
      taskService.findById.mockResolvedValue(mockTask);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      const result = await controller.getOne(chapterId, userId, taskId);

      expect(taskService.findById).toHaveBeenCalledWith(taskId, chapterId);
      expect(result).toBe(mockTask);
    });

    it('should get task if user is admin but not assignee', async () => {
      const chapterId = 'chapter-1';
      const userId = 'admin-1';
      const taskId = 'task-1';
      const mockTask = { id: taskId, assignee_id: 'user-1' } as any;
      taskService.findById.mockResolvedValue(mockTask);
      rbacService.memberHasAnyPermission.mockResolvedValue(true);

      const result = await controller.getOne(chapterId, userId, taskId);

      expect(result).toBe(mockTask);
    });

    it('should throw ForbiddenException if user is neither admin nor assignee', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-2';
      const taskId = 'task-1';
      const mockTask = { id: taskId, assignee_id: 'user-1' } as any;
      taskService.findById.mockResolvedValue(mockTask);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      await expect(
        controller.getOne(chapterId, userId, taskId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("gives a following group's member the task without its proof (#5473)", async () => {
      taskService.findById.mockResolvedValue({
        id: 'task-1',
        assignee_id: 'user-1',
        followed_by: FOLLOWER,
        proof_link: 'https://example.test/proof',
        photos: [
          { id: 'ref', kind: 'reference' },
          { id: 'proof', kind: 'proof' },
        ],
      } as any);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      const read = await controller.getOne('chapter-1', 'follower-1', 'task-1');

      expect(read.proof_link).toBeNull();
      expect(read.photos?.map((photo) => photo.id)).toEqual(['ref']);
      await expect(
        controller.getOne('chapter-1', 'user-2', 'task-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPhotoUrl (#4635)', () => {
    const PHOTO_ID = '0c000000-0000-4000-8000-000000000001';
    const REFERENCE_ID = '0c000000-0000-4000-8000-000000000002';
    const task = {
      id: 'task-1',
      assignee_id: 'user-1',
      followed_by: FOLLOWER,
      photos: [
        { id: REFERENCE_ID, kind: 'reference' },
        { id: PHOTO_ID, kind: 'proof' },
      ],
    } as any;

    it('signs a photo for the assignee', async () => {
      taskService.findById.mockResolvedValue(task);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.getPhotoDownloadUrl.mockResolvedValue({ url: 'https://v' });

      await expect(
        controller.getPhotoUrl('chapter-1', 'user-1', 'task-1', PHOTO_ID),
      ).resolves.toEqual({ url: 'https://v' });
      expect(taskService.getPhotoDownloadUrl).toHaveBeenCalledWith(
        'task-1',
        'chapter-1',
        PHOTO_ID,
      );
    });

    it('refuses a member who is neither the assignee nor an officer', async () => {
      taskService.findById.mockResolvedValue(task);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      await expect(
        controller.getPhotoUrl('chapter-1', 'user-2', 'task-1', PHOTO_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(taskService.getPhotoDownloadUrl).not.toHaveBeenCalled();
    });

    it("signs a follower's reference photo, never a proof photo (#5473)", async () => {
      taskService.findById.mockResolvedValue(task);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.getPhotoDownloadUrl.mockResolvedValue({ url: 'https://v' });

      await expect(
        controller.getPhotoUrl('chapter-1', 'follower-1', 'task-1', PHOTO_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.getPhotoUrl(
          'chapter-1',
          'follower-1',
          'task-1',
          REFERENCE_ID,
        ),
      ).resolves.toEqual({ url: 'https://v' });
      expect(taskService.getPhotoDownloadUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('should create a task', async () => {
      const chapterId = 'chapter-1';
      const userId = 'admin-1';
      const dto: CreateTaskDto = {
        title: 'New Task',
        description: 'Task Description',
        assignee_id: 'user-1',
        due_date: '2025-12-31',
        point_reward: 10,
      };
      const expectedTask = { id: 'new-task', ...dto } as any;
      taskService.create.mockResolvedValue(expectedTask);

      const result = await controller.create(chapterId, userId, dto);

      expect(taskService.create).toHaveBeenCalledWith({
        chapter_id: chapterId,
        title: dto.title,
        description: dto.description,
        assignee_id: dto.assignee_id,
        assignee_ids: null,
        audience: null,
        audience_role_id: null,
        audience_group_id: null,
        audience_tier_id: undefined,
        followed_by: undefined,
        created_by: userId,
        due_date: dto.due_date,
        due_at: null,
        point_reward: dto.point_reward,
      });
      expect(result).toBe(expectedTask);
    });

    it('should handle optional fields gracefully', async () => {
      const chapterId = 'chapter-1';
      const userId = 'admin-1';
      const dto: CreateTaskDto = {
        title: 'New Task',
        assignee_id: 'user-1',
        due_date: '2025-12-31',
      };
      taskService.create.mockResolvedValue({ id: 'new-task' } as any);

      await controller.create(chapterId, userId, dto);

      expect(taskService.create).toHaveBeenCalledWith({
        chapter_id: chapterId,
        title: dto.title,
        description: null,
        assignee_id: dto.assignee_id,
        assignee_ids: null,
        audience: null,
        audience_role_id: null,
        audience_group_id: null,
        audience_tier_id: undefined,
        followed_by: undefined,
        created_by: userId,
        due_date: dto.due_date,
        due_at: null,
        point_reward: null,
      });
    });
  });

  describe('who a task is for (2026-11-18)', () => {
    it('passes several people and a role or group through', async () => {
      taskService.create.mockResolvedValue({ id: 'copy' } as any);

      await controller.create('chapter-1', 'admin-1', {
        title: 'Table at the fair',
        audience: 'everyone',
        audience_role_id: 'role-1',
        due_date: '2026-11-20',
      });
      await controller.create('chapter-1', 'admin-1', {
        title: 'Table at the fair',
        assignee_ids: ['u-1', 'u-2'],
        due_date: '2026-11-20',
      });

      expect(taskService.create.mock.calls[0][0]).toMatchObject({
        audience: 'everyone',
        audience_role_id: 'role-1',
        audience_group_id: null,
        audience_tier_id: undefined,
        followed_by: undefined,
        assignee_ids: null,
      });
      expect(taskService.create.mock.calls[1][0]).toMatchObject({
        assignee_id: null,
        assignee_ids: ['u-1', 'u-2'],
        audience: null,
      });
    });

    it('gives a claimed task back as its caller', async () => {
      openTaskService.release.mockResolvedValue({ id: 'posting-1' });

      await expect(
        controller.release('chapter-1', 'user-1', 'task-1'),
      ).resolves.toEqual({ id: 'posting-1' });
      expect(openTaskService.release).toHaveBeenCalledWith(
        'chapter-1',
        'task-1',
        'user-1',
      );
    });
  });

  describe("everyone's copy (#4295 step 3)", () => {
    it('sends a group edit to the group path', async () => {
      taskService.updateGroup = jest.fn().mockResolvedValue({ id: 't' });

      await controller.update('chapter-1', 'admin-1', 't', {
        scope: 'group',
        title: 'Renamed',
      });

      expect(taskService.updateGroup).toHaveBeenCalledWith(
        't',
        'chapter-1',
        'admin-1',
        { title: 'Renamed' },
      );
    });

    it('refuses a repeat rule on a group edit', async () => {
      await expect(
        controller.update('chapter-1', 'admin-1', 't', {
          scope: 'group',
          recurrence_rule: null,
        }),
      ).rejects.toThrow('A repeat rule changes only with scope "series"');
    });

    it('sends a group delete to the group path', async () => {
      taskService.deleteGroup = jest.fn().mockResolvedValue(undefined);

      await controller.delete('chapter-1', 't', { scope: 'group' });

      expect(taskService.deleteGroup).toHaveBeenCalledWith('t', 'chapter-1');
    });
  });

  describe('removeFromGroup (#5492)', () => {
    it('passes the members to the service and returns the group', async () => {
      const result = {
        removed: ['user-2'],
        group: {
          id: 'group-1',
          audience: 'everyone' as const,
          total: 11,
          done: 3,
          confirmed: 1,
        },
      };
      taskService.removeFromGroup = jest.fn().mockResolvedValue(result);

      await expect(
        controller.removeFromGroup('chapter-1', 't', {
          assignee_ids: ['user-2'],
        }),
      ).resolves.toEqual(result);
      expect(taskService.removeFromGroup).toHaveBeenCalledWith(
        't',
        'chapter-1',
        ['user-2'],
      );
    });

    it('needs tasks:manage', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        TaskController.prototype.removeFromGroup,
      ) as string[];
      expect(required).toEqual([SystemPermissions.TASKS_MANAGE]);
    });
  });

  describe('updateStatus', () => {
    it('should update task status', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const taskId = 'task-1';
      const dto: UpdateTaskStatusDto = { status: TaskStatus.IN_PROGRESS };
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.updateStatus.mockResolvedValue({
        id: taskId,
        status: TaskStatus.IN_PROGRESS,
      } as any);

      const result = await controller.updateStatus(
        chapterId,
        userId,
        taskId,
        dto,
      );

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        chapterId,
        userId,
        [SystemPermissions.TASKS_MANAGE],
      );
      expect(taskService.updateStatus).toHaveBeenCalledWith(
        taskId,
        chapterId,
        userId,
        false,
        dto.status,
        {
          proof_photo_paths: undefined,
          proof_link: undefined,
          completion_note: undefined,
        },
      );
      expect(result).toEqual({ id: taskId, status: TaskStatus.IN_PROGRESS });
    });

    it('passes Mark done’s proof and reply through (#4635)', async () => {
      const dto: UpdateTaskStatusDto = {
        status: TaskStatus.COMPLETED,
        proof_photo_paths: ['chapters/c/tasks/p/x.jpg'],
        proof_link: 'https://example.com',
        completion_note: 'Done',
      };
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.updateStatus.mockResolvedValue({ id: 'task-1' } as any);

      await controller.updateStatus('chapter-1', 'user-1', 'task-1', dto);

      expect(taskService.updateStatus).toHaveBeenCalledWith(
        'task-1',
        'chapter-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
        {
          proof_photo_paths: ['chapters/c/tasks/p/x.jpg'],
          proof_link: 'https://example.com',
          completion_note: 'Done',
        },
      );
    });
  });

  describe('confirmCompletion', () => {
    it('should confirm task completion', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      taskService.confirmCompletion.mockResolvedValue({
        id: taskId,
        points_awarded: true,
      } as any);

      const result = await controller.confirmCompletion(
        chapterId,
        'admin-1',
        taskId,
      );

      // The caller's id is threaded through so the service can refuse a
      // self-confirmation (#1056); the route previously resolved no user at all.
      expect(taskService.confirmCompletion).toHaveBeenCalledWith(
        taskId,
        chapterId,
        'admin-1',
      );
      expect(result).toEqual({ id: taskId, points_awarded: true });
    });
  });

  describe('rejectCompletion', () => {
    it('should reject task completion with a comment', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      const dto: RejectTaskCompletionDto = { comment: 'Needs more work' };
      taskService.rejectCompletion.mockResolvedValue({
        id: taskId,
        status: TaskStatus.IN_PROGRESS,
      } as any);

      const result = await controller.rejectCompletion(
        chapterId,
        'admin-1',
        taskId,
        dto,
      );

      expect(taskService.rejectCompletion).toHaveBeenCalledWith(
        taskId,
        chapterId,
        dto.comment,
        { requirePhoto: undefined, actorUserId: 'admin-1' },
      );
      expect(result).toEqual({ id: taskId, status: TaskStatus.IN_PROGRESS });
    });

    it('passes "ask for a photo next time" through (#4635)', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      const dto: RejectTaskCompletionDto = {
        comment: 'Blurry',
        require_photo: true,
      };
      taskService.rejectCompletion.mockResolvedValue({
        id: taskId,
        status: TaskStatus.IN_PROGRESS,
      } as any);

      await controller.rejectCompletion(chapterId, 'admin-1', taskId, dto);

      expect(taskService.rejectCompletion).toHaveBeenCalledWith(
        taskId,
        chapterId,
        'Blurry',
        { requirePhoto: true, actorUserId: 'admin-1' },
      );
    });
  });

  describe('repeating tasks (#5119)', () => {
    beforeEach(() => {
      taskService.update = jest.fn().mockResolvedValue({ id: 'task-1' });
    });

    it('sends an "All upcoming tasks" edit, rule and all, to the series', async () => {
      const rule = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=UTC';
      await controller.update('chapter-1', 'user-1', 'task-1', {
        scope: 'series',
        title: 'Kitchen',
        recurrence_rule: rule,
      });

      expect(taskSeriesService.update).toHaveBeenCalledWith(
        'task-1',
        'chapter-1',
        'user-1',
        { title: 'Kitchen', recurrence_rule: rule },
      );
      expect(taskService.update).not.toHaveBeenCalled();
    });

    it('sends a "This task only" edit to the task, without the scope', async () => {
      await controller.update('chapter-1', 'user-1', 'task-1', {
        scope: 'instance',
        title: 'Kitchen',
      });

      expect(taskService.update).toHaveBeenCalledWith(
        'task-1',
        'chapter-1',
        'user-1',
        { title: 'Kitchen' },
      );
      expect(taskSeriesService.update).not.toHaveBeenCalled();
    });

    it('refuses a rule on a single-task edit', async () => {
      await expect(
        controller.update('chapter-1', 'user-1', 'task-1', {
          recurrence_rule: null,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(taskService.update).not.toHaveBeenCalled();
    });

    it('sends a delete with scope=series to the series', async () => {
      const result = await controller.delete('chapter-1', 'task-1', {
        scope: 'series',
      });

      expect(taskSeriesService.delete).toHaveBeenCalledWith(
        'task-1',
        'chapter-1',
      );
      expect(taskService.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('delete', () => {
    it('should delete a task', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      taskService.delete.mockResolvedValue(undefined);

      const result = await controller.delete(chapterId, taskId, {});

      expect(taskService.delete).toHaveBeenCalledWith(taskId, chapterId);
      expect(result).toEqual({ success: true });
    });
  });
});
