import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TASK_REPOSITORY } from '../../domain/repositories/task.repository.interface';
import type { ITaskRepository } from '../../domain/repositories/task.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { Task } from '../../domain/entities/task.entity';
import { TaskStatus } from '../../domain/entities/task.entity';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';

const VALID_ASSIGNEE_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.TODO]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.OVERDUE]: [TaskStatus.IN_PROGRESS],
};

function toDisplayStatus(task: Task): Task {
  const today = new Date().toISOString().slice(0, 10);
  if (
    (task.status === TaskStatus.TODO ||
      task.status === TaskStatus.IN_PROGRESS) &&
    task.due_date < today
  ) {
    return { ...task, status: TaskStatus.OVERDUE };
  }
  return task;
}

function toDisplayStatusList(tasks: Task[]): Task[] {
  return tasks.map(toDisplayStatus);
}

export interface CreateTaskInput {
  chapter_id: string;
  title: string;
  description?: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  point_reward?: number | null;
}

export interface UpdateTaskStatusInput {
  status: TaskStatus;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepo: ITaskRepository,
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async findById(id: string, chapterId: string): Promise<Task> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return toDisplayStatus(task);
  }

  async list(
    chapterId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<Task[]> {
    const tasks = isAdmin
      ? await this.taskRepo.findByChapter(chapterId)
      : await this.taskRepo.findByAssignee(chapterId, userId);
    return toDisplayStatusList(tasks);
  }

  async listByChapter(chapterId: string): Promise<Task[]> {
    const tasks = await this.taskRepo.findByChapter(chapterId);
    return toDisplayStatusList(tasks);
  }

  async listByAssignee(chapterId: string, assigneeId: string): Promise<Task[]> {
    const tasks = await this.taskRepo.findByAssignee(chapterId, assigneeId);
    return toDisplayStatusList(tasks);
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const dueDate = new Date(input.due_date);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('due_date must be a valid date');
    }

    const assignee = await this.memberRepo.findByUserAndChapter(
      input.assignee_id,
      input.chapter_id,
    );
    if (!assignee) {
      throw new BadRequestException('Assignee must be a member of the chapter');
    }

    const task = await this.taskRepo.create({
      chapter_id: input.chapter_id,
      title: input.title,
      description: input.description ?? null,
      assignee_id: input.assignee_id,
      created_by: input.created_by,
      due_date: input.due_date,
      status: TaskStatus.TODO,
      point_reward: input.point_reward ?? null,
      points_awarded: false,
      completed_at: null,
      confirmed_at: null,
    });

    await this.safeNotifyUser(
      input.assignee_id,
      input.chapter_id,
      {
        title: 'Task Assigned',
        body: `You have been assigned: ${task.title}`,
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'assignment',
    );

    return task;
  }

  async updateStatus(
    id: string,
    chapterId: string,
    userId: string,
    isAdmin: boolean,
    newStatus: TaskStatus,
  ): Promise<Task> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.assignee_id !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only the assignee or an admin can update task status',
      );
    }

    const allowed = VALID_ASSIGNEE_TRANSITIONS[task.status];
    if (!allowed?.includes(newStatus)) {
      if (
        isAdmin &&
        newStatus === TaskStatus.IN_PROGRESS &&
        task.status === TaskStatus.COMPLETED
      ) {
        // Admin can revert (reject) - handled in rejectCompletion
        throw new BadRequestException(
          'Use the reject completion endpoint to revert a completed task',
        );
      }
      throw new BadRequestException(
        `Invalid status transition from ${task.status} to ${newStatus}`,
      );
    }

    const updateData: Partial<Task> = { status: newStatus };
    if (newStatus === TaskStatus.COMPLETED) {
      updateData.completed_at = new Date().toISOString();
    }

    const updated = await this.taskRepo.update(id, chapterId, updateData);
    return toDisplayStatus(updated);
  }

  async confirmCompletion(id: string, chapterId: string): Promise<Task> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.status !== TaskStatus.COMPLETED) {
      throw new BadRequestException(
        'Task must be marked COMPLETED by assignee before confirmation',
      );
    }

    if (task.points_awarded) {
      throw new BadRequestException(
        'Points have already been awarded for this task',
      );
    }

    const updateData: Partial<Task> = {
      confirmed_at: new Date().toISOString(),
      points_awarded: true,
    };

    if (task.point_reward != null && task.point_reward > 0) {
      await this.pointTxnRepo.create({
        chapter_id: task.chapter_id,
        user_id: task.assignee_id,
        amount: task.point_reward,
        category: 'MANUAL',
        description: `Task completed: ${task.title}`,
        metadata: { task_id: task.id },
      });
    } else {
      updateData.points_awarded = true;
    }

    const updated = await this.taskRepo.update(id, chapterId, updateData);

    await this.safeNotifyUser(
      task.assignee_id,
      chapterId,
      {
        title: 'Task Confirmed',
        body: `Your task "${task.title}" has been confirmed`,
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'confirmation',
    );

    return toDisplayStatus(updated);
  }

  async rejectCompletion(
    id: string,
    chapterId: string,
    comment?: string | null,
  ): Promise<Task> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.status !== TaskStatus.COMPLETED) {
      throw new BadRequestException('Only completed tasks can be rejected');
    }

    if (task.points_awarded) {
      throw new BadRequestException(
        'Cannot reject a task that has already been confirmed and points awarded',
      );
    }

    const updated = await this.taskRepo.update(id, chapterId, {
      status: TaskStatus.IN_PROGRESS,
      completed_at: null,
    });

    await this.safeNotifyUser(
      task.assignee_id,
      chapterId,
      {
        title: 'Task Completion Rejected',
        body: comment
          ? `Your task "${task.title}" was rejected: ${comment}`
          : `Your task "${task.title}" was rejected and moved back to in progress.`,
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'rejection',
    );

    return toDisplayStatus(updated);
  }

  private async safeNotifyUser(
    assigneeId: string,
    chapterId: string,
    payload: NotifyPayload,
    taskId: string,
    notificationContext = 'update',
  ): Promise<void> {
    try {
      await this.notificationService.notifyUser(assigneeId, chapterId, payload);
    } catch (error) {
      this.logger.warn(
        `notifyUser failed for task ${taskId} (${notificationContext}) / assignee ${assigneeId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.taskRepo.delete(id, chapterId);
  }
}
