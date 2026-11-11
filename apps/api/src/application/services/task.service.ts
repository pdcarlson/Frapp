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
import type { Task, TaskSubtask, TaskView } from '#domain/entities/task.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
} from '@repo/validation';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';
import { ChatService } from './chat.service';
import { formatTaskDue, joinFacts } from './push-copy';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

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
export function toDisplayStatus(task: Task, now: Date = new Date()): TaskView {
  const displayStatus =
    (task.status === TaskStatus.TODO ||
      task.status === TaskStatus.IN_PROGRESS) &&
    isPastDue(task, now)
      ? TaskStatus.OVERDUE
      : task.status;
  return { ...task, status: displayStatus, stored_status: task.status };
}

/**
 * A task with a time is past due from that minute; one without is past due
 * from the day after `due_date` (UTC), as it always was (#4003).
 */
function isPastDue(
  task: Pick<Task, 'due_date' | 'due_at'>,
  now: Date,
): boolean {
  const dueAt = task.due_at ? Date.parse(task.due_at) : Number.NaN;
  if (!Number.isNaN(dueAt)) return dueAt <= now.getTime();
  return task.due_date < now.toISOString().slice(0, 10);
}

function toDisplayStatusList(tasks: Task[]): TaskView[] {
  return tasks.map((task) => toDisplayStatus(task));
}

export interface CreateTaskInput {
  chapter_id: string;
  title: string;
  description?: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  /** The moment it is due, when it has a time of day. */
  due_at?: string | null;
  /** Subtask titles, in order (#4003). */
  subtasks?: string[];
  point_reward?: number | null;
  /**
   * When set together with `client_message_id`, an interactive task card is
   * posted to this chat channel after the row commits (the `/task` slash
   * command). Omitted for dashboard creates.
   */
  channel_id?: string;
  client_message_id?: string;
}

/** An officer's edit (#4296). Omitted fields stay as they are. */
export interface UpdateTaskInput {
  title?: string | null;
  description?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
  due_at?: string | null;
  point_reward?: number | null;
}

/**
 * The created task row, plus whether the chat card that accompanies it was
 * posted.
 *
 * `card_posted` is present ONLY when this request actually attempted a card —
 * chat context supplied (`channel_id` + `client_message_id`). A dashboard
 * create's response shape is therefore unchanged. The card stays best-effort
 * — a failed post never rolls the task back — but the caller now learns it
 * failed instead of inferring success from the 2xx and leaving its optimistic
 * placeholder up forever (#1717).
 */
export type CreateTaskResult = Task & {
  card_posted?: boolean;
};

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
    const [view] = await this.withSubtasks(chapterId, [toDisplayStatus(task)]);
    return view;
  }

  /** Each task with its subtasks, in order (#4003). */
  private async withSubtasks(
    chapterId: string,
    tasks: TaskView[],
  ): Promise<TaskView[]> {
    if (tasks.length === 0) return tasks;
    const subtasks = await this.taskRepo.findSubtasks(
      chapterId,
      tasks.map((task) => task.id),
    );
    const byTask = new Map<string, TaskSubtask[]>();
    for (const subtask of subtasks) {
      const list = byTask.get(subtask.task_id) ?? [];
      list.push(subtask);
      byTask.set(subtask.task_id, list);
    }
    return tasks.map((task) => ({
      ...task,
      subtasks: byTask.get(task.id) ?? [],
    }));
  }

  /**
   * Tick or untick one of a task's subtasks (#4003). The assignee, whose
   * checklist it is, or an officer who can manage tasks. A confirmed task is
   * closed: its points are paid, so its checklist no longer moves.
   */
  async setSubtaskDone(
    taskId: string,
    subtaskId: string,
    chapterId: string,
    userId: string,
    isAdmin: boolean,
    done: boolean,
  ): Promise<TaskSubtask> {
    const task = await this.taskRepo.findById(taskId, chapterId);
    if (!task) throw new NotFoundException('Task not found');
    if (task.assignee_id !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only the assignee or an admin can check off subtasks',
      );
    }
    if (task.points_awarded) {
      throw new BadRequestException('This task is already confirmed');
    }
    const updated = await this.taskRepo.setSubtaskDone(
      chapterId,
      taskId,
      subtaskId,
      done ? new Date().toISOString() : null,
    );
    if (!updated) throw new NotFoundException('Subtask not found');
    return updated;
  }

  /** An officer adds a subtask at the end of a task's list (#4003). */
  async addSubtask(
    taskId: string,
    chapterId: string,
    title: string,
  ): Promise<TaskSubtask> {
    const task = await this.taskRepo.findById(taskId, chapterId);
    if (!task) throw new NotFoundException('Task not found');
    if (task.points_awarded) {
      throw new BadRequestException('This task is already confirmed');
    }
    const [clean] = this.checkedSubtaskTitles([title]);
    const existing = await this.taskRepo.findSubtasks(chapterId, [taskId]);
    if (existing.length >= TASK_SUBTASKS_MAX) {
      throw new BadRequestException(
        `A task can have up to ${TASK_SUBTASKS_MAX} subtasks`,
      );
    }
    const position =
      existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const [created] = await this.taskRepo.createSubtasks([
      { task_id: taskId, chapter_id: chapterId, title: clean, position },
    ]);
    return created;
  }

  /** An officer removes one of a task's subtasks (#4003). */
  async deleteSubtask(
    taskId: string,
    subtaskId: string,
    chapterId: string,
  ): Promise<void> {
    const removed = await this.taskRepo.deleteSubtask(
      chapterId,
      taskId,
      subtaskId,
    );
    if (!removed) throw new NotFoundException('Subtask not found');
  }

  /** Trimmed, with blanks dropped; refuses too many or too long. */
  private checkedSubtaskTitles(titles: string[]): string[] {
    const clean = titles.map((title) => title.trim()).filter(Boolean);
    if (clean.length === 0 && titles.length > 0) {
      throw new BadRequestException('A subtask needs a title');
    }
    if (clean.length > TASK_SUBTASKS_MAX) {
      throw new BadRequestException(
        `A task can have up to ${TASK_SUBTASKS_MAX} subtasks`,
      );
    }
    if (clean.some((title) => title.length > TASK_SUBTASK_TITLE_MAX_LENGTH)) {
      throw new BadRequestException(
        `A subtask can be up to ${TASK_SUBTASK_TITLE_MAX_LENGTH} characters`,
      );
    }
    return clean;
  }

  /** A member's display name for a push, or null when it cannot be read. */
  private async displayNameOf(userId: string): Promise<string | null> {
    try {
      const [user] = await this.userRepo.findByIds([userId]);
      const name = user?.display_name?.trim();
      return name ? name : null;
    } catch {
      return null;
    }
  }

  async list(
    chapterId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<TaskView[]> {
    const tasks = isAdmin
      ? await this.taskRepo.findByChapter(chapterId)
      : await this.taskRepo.findByAssignee(chapterId, userId);
    return this.withSubtasks(chapterId, toDisplayStatusList(tasks));
  }

  async create(input: CreateTaskInput): Promise<CreateTaskResult> {
    const dueDate = new Date(input.due_date);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('due_date must be a valid date');
    }
    const dueAt = this.checkedDueAt(input.due_date, input.due_at);
    const subtaskTitles = this.checkedSubtaskTitles(input.subtasks ?? []);

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
      due_at: dueAt,
      status: TaskStatus.TODO,
      point_reward: input.point_reward ?? null,
      points_awarded: false,
      completed_at: null,
      confirmed_at: null,
    });

    // The checklist goes in after its task. A failed insert is reported and
    // the create still succeeds: the task exists, and failing the request
    // would invite a retry that makes a second one. The officer sees a task
    // with no subtasks and can add them from it.
    if (subtaskTitles.length > 0) {
      try {
        await this.taskRepo.createSubtasks(
          subtaskTitles.map((title, position) => ({
            task_id: task.id,
            chapter_id: input.chapter_id,
            title,
            position,
          })),
        );
      } catch (error) {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'task-subtasks-create',
          message: `subtask insert failed for task ${task.id}`,
          error,
        });
      }
    }

    await this.notifyAssigned(task, input.created_by);

    // The `/task` slash command asks us to surface an interactive assignment
    // card in chat. The card is server-originated (a client cannot forge
    // `kind:"task"` — see ChatService.SERVER_ONLY_KINDS) and best-effort: the
    // task row is the source of truth, so a failed post is logged and never
    // rolls the task back — but the outcome is now REPORTED rather than
    // swallowed. The client renders an optimistic `loading` placeholder keyed
    // on `client_message_id` and waits for the Realtime echo of this card to
    // reconcile it; when the post fails that echo never arrives, so without
    // an explicit signal the placeholder is permanent and the officer cannot
    // tell a committed create from a lost one (#1717).
    //
    // `undefined` means no card was attempted (a dashboard create), which is
    // reported as an ABSENT field rather than a `false` that would claim a card
    // failed when none was ever due.
    const cardPosted = await this.tryPostTaskCard(input, task);

    return cardPosted === undefined
      ? task
      : { ...task, card_posted: cardPosted };
  }

  /**
   * Tell a task's assignee it is theirs, named for the task with who assigned
   * it, when it is due and its points. Assigning yourself a task is a note to
   * self, so the push would only echo the tap that made it.
   */
  private async notifyAssigned(task: Task, assignerId: string): Promise<void> {
    if (task.assignee_id === assignerId) return;
    const [assigner, creatorZone] = await Promise.all([
      this.displayNameOf(assignerId),
      // Only a timed task's push names a clock, so only it needs a zone.
      task.due_at
        ? this.notificationService.timeZoneFor(assignerId).catch(() => null)
        : null,
    ]);
    // A task with a time reads in the assignee's zone; one who has not
    // reported a zone reads it in the assigner's, labelled (push-copy.ts).
    const body = (timeZone: string | null, labelZone: boolean) =>
      joinFacts(
        assigner ? `From ${assigner}` : 'Assigned to you',
        `due ${formatTaskDue(task.due_date, task.due_at, { timeZone, labelZone })}`,
        task.point_reward ? `${task.point_reward} points` : null,
      );
    await this.safeNotifyUser(
      task.assignee_id,
      task.chapter_id,
      {
        // Named for the task, like every task push (notifications.md § What
        // a push says): "Book the venue" / "From Paul · due Fri, Nov 14".
        title: task.title,
        body: body(creatorZone, true),
        personalize: (recipient) => ({
          title: task.title,
          body: recipient.timeZone
            ? body(recipient.timeZone, false)
            : body(creatorZone, true),
        }),
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'assignment',
    );
  }

  /**
   * An officer edits a task after it is made (#4296): title, description,
   * assignee, due date and time, points. Any of them, until the task is
   * confirmed; after that its points are paid on the task as it stood, so it
   * is a record and stays as it is.
   *
   * - A new assignee starts the task over: back to To do with no completion
   *   and no send-back, since the old assignee's progress isn't theirs. They
   *   get the assignment push. It is also how a single-officer chapter clears
   *   a completed self-assigned task no one may confirm (#1340).
   * - A new due date or time, or a new assignee, releases the task's reminder
   *   claims so the sweeps remind about it afresh.
   * - The chat card posted at creation is a snapshot and stays as posted; its
   *   live status line reads the task.
   */
  async update(
    id: string,
    chapterId: string,
    actorId: string,
    input: UpdateTaskInput,
  ): Promise<TaskView> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) throw new NotFoundException('Task not found');
    if (task.points_awarded) {
      throw new BadRequestException(
        'This task is already confirmed, so it can no longer change',
      );
    }

    const patch: Partial<Task> = {};

    if (input.title !== undefined) {
      const title = input.title?.trim();
      if (!title) throw new BadRequestException('A task needs a title');
      if (title !== task.title) patch.title = title;
    }

    if (input.description !== undefined) {
      const description = input.description?.trim() || null;
      if (description !== task.description) patch.description = description;
    }

    if (input.point_reward !== undefined) {
      const reward = input.point_reward || null;
      if (reward !== task.point_reward) patch.point_reward = reward;
    }

    if (input.due_date !== undefined || input.due_at !== undefined) {
      if (input.due_date === null) {
        throw new BadRequestException('A task needs a due date');
      }
      const dueDate = (input.due_date ?? task.due_date).slice(0, 10);
      if (Number.isNaN(new Date(dueDate).getTime())) {
        throw new BadRequestException('due_date must be a valid date');
      }
      const dueAt = this.checkedDueAt(
        dueDate,
        input.due_at === undefined ? task.due_at : input.due_at,
      );
      const storedAt = task.due_at ? new Date(task.due_at).toISOString() : null;
      if (dueDate !== task.due_date.slice(0, 10)) patch.due_date = dueDate;
      if (dueAt !== storedAt) patch.due_at = dueAt;
    }

    const reassigned =
      input.assignee_id !== undefined && input.assignee_id !== task.assignee_id;
    if (reassigned) {
      if (!input.assignee_id) {
        throw new BadRequestException('A task needs an assignee');
      }
      const member = await this.memberRepo.findByUserAndChapter(
        input.assignee_id,
        chapterId,
      );
      if (!member) {
        throw new BadRequestException(
          'Assignee must be a member of the chapter',
        );
      }
      patch.assignee_id = input.assignee_id;
      patch.status = TaskStatus.TODO;
      patch.completed_at = null;
      patch.sent_back_at = null;
    }

    if (Object.keys(patch).length === 0) return this.findById(id, chapterId);

    const updated = await this.taskRepo.updateUnconfirmed(id, chapterId, patch);
    if (!updated) {
      throw new BadRequestException(
        'This task was confirmed while you were editing it, so it can no longer change',
      );
    }

    if (reassigned || 'due_date' in patch || 'due_at' in patch) {
      try {
        await this.taskRepo.releaseReminderClaims(chapterId, id);
      } catch (error) {
        // The edit stands; the cost is a reminder that may not go out again.
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'task-edit-release-reminders',
          message: `reminder release failed for task ${id}`,
          error,
        });
      }
    }

    if (reassigned) await this.notifyAssigned(updated, actorId);

    const [view] = await this.withSubtasks(chapterId, [
      toDisplayStatus(updated),
    ]);
    return view;
  }

  /**
   * `due_at` as stored, or null for a task with no time. `due_date` is the day
   * of `due_at` in the creator's zone, which the server does not know, but no
   * zone is more than 14 hours from UTC: a pair further apart than that is a
   * client bug, refused rather than stored as a task due on two days.
   */
  private checkedDueAt(
    dueDate: string,
    dueAt: string | null | undefined,
  ): string | null {
    if (!dueAt) return null;
    const at = Date.parse(dueAt);
    if (Number.isNaN(at)) {
      throw new BadRequestException('due_at must be a valid date and time');
    }
    const dayStart = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
    const hour = 60 * 60 * 1000;
    if (at < dayStart - 14 * hour || at >= dayStart + 38 * hour) {
      throw new BadRequestException('due_at must fall on due_date');
    }
    return new Date(at).toISOString();
  }

  /**
   * Returns whether the card posted, or `undefined` when no card was due
   * (no chat context) — the three-way distinction `card_posted` publishes.
   */
  private async tryPostTaskCard(
    input: CreateTaskInput,
    task: Task,
  ): Promise<boolean | undefined> {
    if (!input.channel_id || !input.client_message_id) return undefined;

    try {
      await this.postTaskCard(input, task);
      return true;
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Failed to post task card to chat (task ${task.id}, channel ${input.channel_id}, chapter ${input.chapter_id})`,
        error,
      );
      return false;
    }
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
      due_at: task.due_at,
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

    // The assignee taking back their own "done" before an officer confirms it
    // (a stray tap, or a second look). It is the reject write without the
    // reject: same compare-and-set, so a confirm that lands first wins and
    // this refuses rather than un-completing a task whose points were paid.
    // Only the assignee: an officer moving someone else's completed task back
    // is a rejection, which notifies them, and goes through its own endpoint.
    if (
      task.status === TaskStatus.COMPLETED &&
      newStatus === TaskStatus.IN_PROGRESS &&
      task.assignee_id === userId
    ) {
      return this.reopenOwnCompletion(task, chapterId);
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

  private async reopenOwnCompletion(
    task: Task,
    chapterId: string,
  ): Promise<TaskView> {
    if (task.points_awarded) {
      throw new BadRequestException(
        'An officer already confirmed this task, so it stays done',
      );
    }
    const updated = await this.taskRepo.reopenCompletion(task.id, chapterId);
    if (!updated) {
      // Null is any write that moved it first: an officer's confirm, their
      // reject, or this member's own take-back from another device.
      throw new BadRequestException(
        'This task is no longer waiting on confirmation',
      );
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
      logThrowable(
        this.logger,
        'warn',
        `findByUserAndChapter failed while checking task ${task.id} creator membership`,
        error,
      );
      return;
    }
    if (!creatorMembership) return;

    await this.safeNotifyUser(
      task.created_by,
      chapterId,
      {
        title: task.title,
        body: `${
          (await this.displayNameOf(task.assignee_id)) ?? 'The assignee'
        } marked it done. Confirm it to award the points.`,
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
        title: task.title,
        body: updated.point_reward
          ? `Confirmed · +${updated.point_reward} points`
          : 'Confirmed',
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

    // Compare-and-set, so a confirm (or the assignee taking it back) that
    // lands between the guards above and this write is not overwritten. The
    // send-back time is when it waits on the assignee again: Activity serves
    // it unread to them from then (`spec/behavior/activity.md` § Unread).
    const updated = await this.taskRepo.reopenCompletion(
      id,
      chapterId,
      new Date().toISOString(),
    );
    if (!updated) {
      throw new BadRequestException(
        'Task is no longer waiting on confirmation — it was confirmed or moved back already',
      );
    }

    await this.safeNotifyUser(
      task.assignee_id,
      chapterId,
      {
        title: task.title,
        body: comment
          ? `Sent back: ${comment}`
          : 'Sent back to in progress. It needs more before it counts.',
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
      // A notification nobody retries (#4096): reported so a failing
      // notifications write isn't silent.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'task-notify',
        message: `notifyUser failed for task ${taskId} (${notificationContext}) / assignee ${assigneeId}`,
        error,
      });
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
