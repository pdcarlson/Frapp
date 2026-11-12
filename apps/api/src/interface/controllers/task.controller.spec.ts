import { TaskStatus } from '#domain/entities/task.entity';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { TaskController } from './task.controller';
import { TaskService } from '../../application/services/task.service';
import { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { ForbiddenException } from '@nestjs/common';
import {
  CreateTaskDto,
  UpdateTaskStatusDto,
  RejectTaskCompletionDto,
} from '../dtos/task.dto';

describe('TaskController', () => {
  let controller: TaskController;
  let taskService: jest.Mocked<TaskService>;
  let rbacService: jest.Mocked<RbacService>;

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
    } as any;

    rbacService = {
      memberHasAnyPermission: jest.fn(),
    } as any;

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: RbacService, useValue: rbacService },
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
      );
      expect(result).toBe(mockTasks);
    });

    it('should list tasks with false admin status if user lacks permission', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.list.mockResolvedValue([]);

      await controller.list(chapterId, userId, {});

      expect(taskService.list).toHaveBeenCalledWith(
        chapterId,
        userId,
        false,
        {},
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
  });

  describe('getPhotoUrl (#4565)', () => {
    const task = { id: 'task-1', assignee_id: 'user-1' } as any;

    it('signs a photo for the assignee', async () => {
      taskService.findById.mockResolvedValue(task);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.getPhotoDownloadUrl.mockResolvedValue({ url: 'https://v' });

      await expect(
        controller.getPhotoUrl('chapter-1', 'user-1', 'task-1', {
          photo: 'proof',
        }),
      ).resolves.toEqual({ url: 'https://v' });
      expect(taskService.getPhotoDownloadUrl).toHaveBeenCalledWith(
        task,
        'chapter-1',
        'proof',
      );
    });

    it('refuses a member who is neither the assignee nor an officer', async () => {
      taskService.findById.mockResolvedValue(task);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      await expect(
        controller.getPhotoUrl('chapter-1', 'user-2', 'task-1', {
          photo: 'reference',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(taskService.getPhotoDownloadUrl).not.toHaveBeenCalled();
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
        created_by: userId,
        due_date: dto.due_date,
        due_at: null,
        point_reward: null,
      });
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
        undefined,
      );
      expect(result).toEqual({ id: taskId, status: TaskStatus.IN_PROGRESS });
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

      const result = await controller.rejectCompletion(chapterId, taskId, dto);

      expect(taskService.rejectCompletion).toHaveBeenCalledWith(
        taskId,
        chapterId,
        dto.comment,
      );
      expect(result).toEqual({ id: taskId, status: TaskStatus.IN_PROGRESS });
    });

    it('should reject task completion without a comment', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      const dto: RejectTaskCompletionDto = {};
      taskService.rejectCompletion.mockResolvedValue({
        id: taskId,
        status: TaskStatus.IN_PROGRESS,
      } as any);

      await controller.rejectCompletion(chapterId, taskId, dto);

      expect(taskService.rejectCompletion).toHaveBeenCalledWith(
        taskId,
        chapterId,
        null,
      );
    });
  });

  describe('delete', () => {
    it('should delete a task', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      taskService.delete.mockResolvedValue(undefined);

      const result = await controller.delete(chapterId, taskId);

      expect(taskService.delete).toHaveBeenCalledWith(taskId, chapterId);
      expect(result).toEqual({ success: true });
    });
  });
});
