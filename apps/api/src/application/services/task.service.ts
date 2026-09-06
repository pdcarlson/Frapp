import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { Task, TaskView } from '#domain/entities/task.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';
import { ChatService } from './chat.service';

const VALID_ASSIGNEE_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.TODO]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.OVERDUE]: [TaskStatus.IN_PROGRESS],
};

/**
 * Rewrite a task's status to the value clients should render.
 *
 * `stored_status` travels alongside it and always carries the persisted value.
 * It is not cosmetic: the transition table above is checked against the stored
 * status, and `OVERDUE` collapses `TODO` and `IN_PROGRESS` into one indistinct
 * value, so a client holding only `status` cannot tell which transition is
 * legal — and therefore cannot offer the assignee any action at all (#1051).
 */
function toDisplayStatus(task: Task): TaskView {
  const today = new Date().toISOString().slice(0, 10);
  const displayStatus =
    (task.status === TaskStatus.TODO ||
      task.status === TaskStatus.IN_PROGRESS) &&
    task.due_date < today
      ? TaskStatus.OVERDUE
      : task.status;
  return { ...task, status: displayStatus, stored_status: task.status };
}

function toDisplayStatusList(tasks: Task[]): TaskView[] {
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
  /**
   * When set together with `client_message_id`, an interactive task card is
   * posted to this chat channel after the row commits (the `/task` slash
   * command). Omitted for dashboard creates.
   */
  channel_id?: string;
  client_message_id?: string;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepo: ITaskRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly notificationService: NotificationService,
    private readonly chatService: ChatService,
  ) {}

  async findById(id: string, chapterId: string): Promise<TaskView> {
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
  ): Promise<TaskView[]> {
    const tasks = isAdmin
      ? await this.taskRepo.findByChapter(chapterId)
      : await this.taskRepo.findByAssignee(chapterId, userId);
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

    // The `/task` slash command asks us to surface an interactive assignment
    // card in chat. The card is server-originated (a client cannot forge
    // `kind:"task"` — see ChatService.SERVER_ONLY_KINDS) and best-effort: the
    // task row is the source of truth, so a failed post is logged and never
    // rolls the task back.
    if (input.channel_id && input.client_message_id) {
      try {
        await this.postTaskCard(input, task);
      } catch (error) {
        this.logger.warn('Failed to post task card to chat', {
          taskId: task.id,
          channelId: input.channel_id,
          chapterId: input.chapter_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return task;
  }

  /**
   * Post the `kind:"task"` assignment card for a committed task. Names are
   * resolved here and embedded in the payload so the snapshot stays a correct
   * record even if a member later leaves the chapter. The card carries the
   * task id; the renderer reads live status back through the task query (the
   * chat message row is never mutated). Posts as the admin (the creator) into
   * the channel they ran the command from; channel access is re-checked by
   * `ChatService.sendMessage`.
   */
  private async postTaskCard(
    input: CreateTaskInput,
    task: Task,
  ): Promise<void> {
    const users = await this.userRepo.findByIds([
      input.created_by,
      input.assignee_id,
    ]);
    const nameOf = (id: string): string =>
      users.find((u) => u.id === id)?.display_name ?? 'Unknown member';
    const assignerName = nameOf(input.created_by);
    const assigneeName = nameOf(input.assignee_id);

    const payload = {
      task_id: task.id,
      title: task.title,
      assigner_user_id: input.created_by,
      assigner_name: assignerName,
      assignee_user_id: input.assignee_id,
      assignee_name: assigneeName,
      due_date: task.due_date,
      status: 'TODO' as const,
      point_reward: task.point_reward,
      created_at: task.created_at,
    };

    const content = `Assigned "${task.title}" to ${assigneeName} (due ${task.due_date})`;

    await this.chatService.sendMessage({
      chapter_id: input.chapter_id,
      channel_id: input.channel_id!,
      sender_id: input.created_by,
      content,
      kind: 'task',
      payload,
      client_message_id: input.client_message_id,
      system_originated: true,
    });
  }

  async updateStatus(
    id: string,
    chapterId: string,
    userId: string,
    isAdmin: boolean,
    newStatus: TaskStatus,
  ): Promise<TaskView> {
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

    if (newStatus === TaskStatus.COMPLETED) {
      await this.notifyTaskCompleted(updated, userId, chapterId);
    }

    return toDisplayStatus(updated);
  }

  /**
   * A completed task needs a `tasks:manage` holder to confirm it before
   * points are awarded (spec/behavior/tasks.md), so the task's creator is
   * notified rather than every `tasks:manage` holder in the chapter — the
   * same "notify the creator, not a fan-out" rule the OVERDUE sweep already
   * uses (`scheduled-jobs.service.ts`'s `notifyTaskOverdue`), so completing
   * one task never turns into an unbounded broadcast to every officer.
   *
   * No-ops when the creator is the one who just completed it (self-assigned
   * task, nothing to tell them) or has since left the chapter.
   */
  private async notifyTaskCompleted(
    task: Task,
    actorUserId: string,
    chapterId: string,
  ): Promise<void> {
    if (task.created_by === actorUserId) return;

    let creatorMembership: Awaited<
      ReturnType<typeof this.memberRepo.findByUserAndChapter>
    >;
    try {
      creatorMembership = await this.memberRepo.findByUserAndChapter(
        task.created_by,
        chapterId,
      );
    } catch (error) {
      this.logger.warn(
        `findByUserAndChapter failed while checking task ${task.id} creator membership`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }
    if (!creatorMembership) return;

    await this.safeNotifyUser(
      task.created_by,
      chapterId,
      {
        title: 'Task Completed',
        body: `"${task.title}" was marked complete and needs your confirmation.`,
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'completion',
    );
  }

  async confirmCompletion(
    id: string,
    chapterId: string,
    callerUserId: string,
  ): Promise<TaskView> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Confirming awards `point_reward` to the assignee's ledger, so a holder of
    // `tasks:manage` confirming their own task moves their own balance with no
    // second party. `PointsService.adjustPoints` already refuses the equivalent
    // (`points.service.ts:215`). The rule this implements is `points.md`'s
    // "No self-award" bullet, which binds the ledger rather than one endpoint;
    // the neighbouring ceiling bullet applies that same ledger-wide reasoning to
    // a different control. This is the rule reaching the path it missed.
    //
    // Ordered before the status guard deliberately: which refusal a caller sees
    // must not depend on what state their own task happens to be in, and an
    // authorization failure is the more fundamental of the two.
    if (task.assignee_id === callerUserId) {
      throw new ForbiddenException(
        'Admins cannot confirm their own task completions',
      );
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

    // Confirm the task and award its point reward atomically: a single DB
    // transaction (compare-and-set on `points_awarded`) so a partial failure
    // can't leave points without a confirmation, and concurrent confirms can't
    // double-award. The guards above are a friendly fast path; the RPC's
    // conditional update is the authoritative concurrency guard. Returns null
    // when nothing was updated: points already awarded, or the task is no longer
    // COMPLETED (e.g. a concurrent admin rejection reverted it) between the
    // fast-path guard and the RPC — so keep the message broad enough for both.
    const updated = await this.taskRepo.confirmCompletionAtomic(id, chapterId);
    if (!updated) {
      throw new BadRequestException(
        'Task confirmation failed — task is no longer eligible or points were already awarded',
      );
    }

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
  ): Promise<TaskView> {
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
