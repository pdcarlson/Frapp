import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from './task.controller';
import { TaskService } from '../../application/services/task.service';
import { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '../../domain/constants/permissions';
import { ForbiddenException } from '@nestjs/common';
import { CreateTaskDto, UpdateTaskStatusDto, RejectTaskCompletionDto } from '../dtos/task.dto';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

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
    } as any;

    rbacService = {
      memberHasAnyPermission: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: RbacService, useValue: rbacService },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

      const result = await controller.list(chapterId, userId);

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(chapterId, userId, [SystemPermissions.TASKS_MANAGE]);
      expect(taskService.list).toHaveBeenCalledWith(chapterId, userId, true);
      expect(result).toBe(mockTasks);
    });

    it('should list tasks with false admin status if user lacks permission', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.list.mockResolvedValue([]);

      await controller.list(chapterId, userId);

      expect(taskService.list).toHaveBeenCalledWith(chapterId, userId, false);
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

      await expect(controller.getOne(chapterId, userId, taskId)).rejects.toThrow(ForbiddenException);
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
        point_reward: null,
      });
    });
  });

  describe('updateStatus', () => {
    it('should update task status', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const taskId = 'task-1';
      const dto: UpdateTaskStatusDto = { status: 'IN_PROGRESS' };
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      taskService.updateStatus.mockResolvedValue({ id: taskId, status: 'IN_PROGRESS' } as any);

      const result = await controller.updateStatus(chapterId, userId, taskId, dto);

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(chapterId, userId, [SystemPermissions.TASKS_MANAGE]);
      expect(taskService.updateStatus).toHaveBeenCalledWith(taskId, chapterId, userId, false, dto.status);
      expect(result).toEqual({ id: taskId, status: 'IN_PROGRESS' });
    });
  });

  describe('confirmCompletion', () => {
    it('should confirm task completion', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      taskService.confirmCompletion.mockResolvedValue({ id: taskId, points_awarded: true } as any);

      const result = await controller.confirmCompletion(chapterId, taskId);

      expect(taskService.confirmCompletion).toHaveBeenCalledWith(taskId, chapterId);
      expect(result).toEqual({ id: taskId, points_awarded: true });
    });
  });

  describe('rejectCompletion', () => {
    it('should reject task completion with a comment', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      const dto: RejectTaskCompletionDto = { comment: 'Needs more work' };
      taskService.rejectCompletion.mockResolvedValue({ id: taskId, status: 'IN_PROGRESS' } as any);

      const result = await controller.rejectCompletion(chapterId, taskId, dto);

      expect(taskService.rejectCompletion).toHaveBeenCalledWith(taskId, chapterId, dto.comment);
      expect(result).toEqual({ id: taskId, status: 'IN_PROGRESS' });
    });

    it('should reject task completion without a comment', async () => {
      const chapterId = 'chapter-1';
      const taskId = 'task-1';
      const dto: RejectTaskCompletionDto = {};
      taskService.rejectCompletion.mockResolvedValue({ id: taskId, status: 'IN_PROGRESS' } as any);

      await controller.rejectCompletion(chapterId, taskId, dto);

      expect(taskService.rejectCompletion).toHaveBeenCalledWith(taskId, chapterId, null);
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
