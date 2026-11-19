import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  TASK_AUDIENCE_COPY,
  type OpenTaskScope,
  type TaskProofKind,
} from '@repo/validation';
import { OPEN_TASK_REPOSITORY } from '#domain/repositories/open-task.repository.interface';
import type {
  IOpenTaskRepository,
  OpenTaskChanges,
} from '#domain/repositories/open-task.repository.interface';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { OpenTask, OpenTaskView } from '#domain/entities/open-task.entity';
import type { TaskView } from '#domain/entities/task.entity';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';
import { formatTaskDue, joinFacts } from './push-copy';
import {
  TaskAudienceService,
  type TaskAudienceReader,
  type TaskAudienceTarget,
} from './task-audience.service';
import {
  checkedDueAt,
  checkedDueDate,
  checkedSubtaskTitles,
} from './task-input-checks';
import { GROUP_NOTIFY_CONCURRENCY, TaskService } from './task.service';
import { displayNameFor, notifyQuietly } from './task-push';

/** A posting's own fields, as an officer writes them. */
export interface OpenTaskFields {
  title: string;
  description?: string | null;
  due_date: string;
  due_at?: string | null;
  point_reward?: number | null;
  proof_kind?: TaskProofKind;
  /** The checklist the claimed task starts with, in order. */
  subtasks?: string[];
}

export interface CreateOpenTaskInput extends OpenTaskFields {
  chapter_id: string;
  created_by: string;
  /** Who may claim it. */
  target: TaskAudienceTarget;
  /** The minutes it was suggested from (#5562); set only by that accept. */
  meeting_id?: string | null;
}

/** An officer's edit of an open posting. Omitted fields stay as they are. */
export type UpdateOpenTaskInput = Partial<OpenTaskFields>;

/** A posting's scope as the target its eligibility is read from. */
function targetOf(posting: OpenTask): TaskAudienceTarget {
  switch (posting.scope) {
    case 'role':
      return { kind: 'role', id: posting.scope_id ?? '' };
    case 'group':
      return { kind: 'group', id: posting.scope_id ?? '' };
    case 'people':
      return { kind: 'people', userIds: posting.scope_user_ids ?? [] };
    case 'chapter':
      return { kind: 'chapter' };
  }
}

/**
 * Tasks up for grabs (Paul, 2026-11-18; `spec/behavior/tasks.md` § Up for
 * grabs): one task posted for someone in the chapter, a role, a chapter group
 * or a list of people, which any eligible member claims, or an officer hands
 * to someone. Claiming writes one ordinary task (`claim_open_task`), so from
 * then on it is marked done, confirmed and paid like any task. Its assignee
 * can give it back until they've finished it, which puts the posting back up.
 *
 * Eligibility is read when it matters, not when posted: who holds the role
 * or is in the group at the claim, alumni always left out. A posting for a
 * role or group since deleted is claimable by nobody until an officer hands
 * it to someone.
 */
@Injectable()
export class OpenTaskService {
  private readonly logger = new Logger(OpenTaskService.name);

  constructor(
    @Inject(OPEN_TASK_REPOSITORY)
    private readonly openTaskRepo: IOpenTaskRepository,
    @Inject(TASK_REPOSITORY) private readonly taskRepo: ITaskRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly audiences: TaskAudienceService,
    private readonly tasks: TaskService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * The open postings the reader may claim, oldest due first; a `tasks:manage`
   * holder reads every open posting, claimable or not.
   */
  async list(
    chapterId: string,
    userId: string,
    isManager: boolean,
  ): Promise<OpenTaskView[]> {
    const postings = await this.openTaskRepo.findOpen(chapterId);
    if (postings.length === 0) return [];
    const reader = await this.audiences.reader(chapterId);
    const views = await Promise.all(
      postings.map((posting) => this.view(reader, posting, userId)),
    );
    return isManager ? views : views.filter((view) => view.viewer_can_claim);
  }

  /** One posting as its reads return it, for `userId`. */
  private async view(
    reader: TaskAudienceReader,
    posting: OpenTask,
    userId: string,
  ): Promise<OpenTaskView> {
    const eligible = await reader.eligible(targetOf(posting));
    const liveName =
      posting.scope === 'role' || posting.scope === 'group'
        ? posting.scope_id
          ? await reader.nameOf(posting.scope, posting.scope_id)
          : null
        : null;
    return {
      ...posting,
      scope_name: liveName ?? posting.scope_name,
      eligible_count: eligible.length,
      viewer_can_claim: posting.status === 'open' && eligible.includes(userId),
    };
  }

  private async viewOne(
    chapterId: string,
    posting: OpenTask,
    userId: string,
  ): Promise<OpenTaskView> {
    return this.view(await this.audiences.reader(chapterId), posting, userId);
  }

  /**
   * Post a task up for grabs. Its fields get the checks a task's get; who may
   * claim it must reach someone now. Everyone who may, but the officer, gets a
   * push in the Tasks category.
   */
  async create(input: CreateOpenTaskInput): Promise<OpenTaskView> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('A task needs a title');
    const dueDate = checkedDueDate(input.due_date).slice(0, 10);
    const dueAt = checkedDueAt(dueDate, input.due_at);
    const subtaskTitles = checkedSubtaskTitles(input.subtasks ?? []);
    const reader = await this.audiences.reader(input.chapter_id);
    const resolved = await reader.resolve(input.target);
    const scope: OpenTaskScope = resolved.kind;

    const posting = await this.openTaskRepo.create({
      chapter_id: input.chapter_id,
      created_by: input.created_by,
      title,
      description: input.description?.trim() || null,
      due_date: dueDate,
      due_at: dueAt,
      point_reward: input.point_reward || null,
      proof_kind: input.proof_kind ?? 'none',
      subtask_titles: subtaskTitles,
      scope,
      scope_id: resolved.targetId,
      scope_name: resolved.targetName,
      scope_user_ids: scope === 'people' ? resolved.userIds : null,
      meeting_id: input.meeting_id ?? null,
    });

    await this.notifyPosted(
      posting,
      resolved.userIds.filter((id) => id !== input.created_by),
    );
    return {
      ...posting,
      eligible_count: resolved.userIds.length,
      viewer_can_claim: resolved.userIds.includes(input.created_by),
    };
  }

  /**
   * Tell who may claim a new posting that it's up: "Up for grabs: Drive to
   * the store" / "10 points · Due Fri, Nov 21", a few at a time. One push
   * failing doesn't stop the rest.
   */
  private async notifyPosted(
    posting: OpenTask,
    recipients: string[],
  ): Promise<void> {
    if (recipients.length === 0) return;
    const creatorZone = posting.due_at
      ? await this.notificationService
          .timeZoneFor(posting.created_by)
          .catch(() => null)
      : null;
    const body = (timeZone: string | null, labelZone: boolean) =>
      joinFacts(
        posting.point_reward ? `${posting.point_reward} points` : null,
        `Due ${formatTaskDue(posting.due_date, posting.due_at, { timeZone, labelZone })}`,
      );
    const title = `${TASK_AUDIENCE_COPY.upForGrabs}: ${posting.title}`;
    const payload: NotifyPayload = {
      title,
      body: body(creatorZone, true),
      personalize: (recipient) => ({
        title,
        body: recipient.timeZone
          ? body(recipient.timeZone, false)
          : body(creatorZone, true),
      }),
      priority: 'NORMAL',
      category: 'tasks',
      data: { target: { screen: 'tasks', openTaskId: posting.id } },
    };
    for (let i = 0; i < recipients.length; i += GROUP_NOTIFY_CONCURRENCY) {
      await Promise.all(
        recipients
          .slice(i, i + GROUP_NOTIFY_CONCURRENCY)
          .map((userId) =>
            this.safeNotify(userId, posting.chapter_id, payload, posting.id),
          ),
      );
    }
  }

  /** The posting, or 404. */
  private async posting(chapterId: string, id: string): Promise<OpenTask> {
    const posting = await this.openTaskRepo.findById(chapterId, id);
    if (!posting) throw new NotFoundException('Task not found');
    return posting;
  }

  /** 409 for a posting someone already has. */
  private assertOpen(posting: OpenTask): void {
    if (posting.status !== 'open') {
      throw new ConflictException(TASK_AUDIENCE_COPY.alreadyClaimed);
    }
  }

  /**
   * An officer's edit of a posting while it is open: its title, description,
   * due, points, proof and checklist. Who may claim it stays; delete and post
   * it again to change that. 409 once someone has claimed it.
   */
  async update(
    chapterId: string,
    id: string,
    userId: string,
    input: UpdateOpenTaskInput,
  ): Promise<OpenTaskView> {
    const posting = await this.posting(chapterId, id);
    this.assertOpen(posting);
    const changes: OpenTaskChanges = {};
    if (input.title !== undefined) {
      const title = input.title?.trim();
      if (!title) throw new BadRequestException('A task needs a title');
      changes.title = title;
    }
    if (input.description !== undefined) {
      changes.description = input.description?.trim() || null;
    }
    if (input.due_date !== undefined || input.due_at !== undefined) {
      if (input.due_date === null) {
        throw new BadRequestException('A task needs a due date');
      }
      const dueDate = checkedDueDate(
        (input.due_date ?? posting.due_date).slice(0, 10),
      );
      changes.due_date = dueDate;
      changes.due_at = checkedDueAt(
        dueDate,
        input.due_at === undefined ? posting.due_at : input.due_at,
      );
    }
    if (input.point_reward !== undefined) {
      changes.point_reward = input.point_reward || null;
    }
    // Null isn't a value for either: no proof is "none", no checklist is [].
    if (input.proof_kind === null || input.subtasks === null) {
      throw new BadRequestException(
        'Send proof_kind "none" or an empty subtasks list to clear them',
      );
    }
    if (input.proof_kind !== undefined) changes.proof_kind = input.proof_kind;
    if (input.subtasks !== undefined) {
      changes.subtask_titles = checkedSubtaskTitles(input.subtasks);
    }
    if (Object.keys(changes).length === 0) {
      return this.viewOne(chapterId, posting, userId);
    }
    const updated = await this.openTaskRepo.updateOpen(chapterId, id, changes);
    // Null is a claim (or a delete) landing between the read and the write.
    if (!updated) {
      this.assertOpen(await this.posting(chapterId, id));
      throw new ConflictException(TASK_AUDIENCE_COPY.alreadyClaimed);
    }
    return this.viewOne(chapterId, updated, userId);
  }

  /** Delete a posting while it is open; 409 once someone has claimed it. */
  async delete(chapterId: string, id: string): Promise<void> {
    if (await this.openTaskRepo.deleteOpen(chapterId, id)) return;
    this.assertOpen(await this.posting(chapterId, id));
    throw new ConflictException(TASK_AUDIENCE_COPY.alreadyClaimed);
  }

  /**
   * A member takes a posting they may claim now (alumni never may). Of two
   * claims at once, one wins and the other gets 409. The posting's creator
   * is told, unless they claimed it themselves. Returns the new task.
   */
  async claim(
    chapterId: string,
    id: string,
    userId: string,
  ): Promise<TaskView> {
    const posting = await this.posting(chapterId, id);
    this.assertOpen(posting);
    const reader = await this.audiences.reader(chapterId);
    if (!(await reader.eligible(targetOf(posting))).includes(userId)) {
      throw new ForbiddenException("This task isn't up for grabs for you");
    }
    const task = await this.take(posting, userId);

    if (posting.created_by !== userId) {
      const [name, posterZone] = await Promise.all([
        this.displayNameOf(userId),
        posting.due_at
          ? this.notificationService
              .timeZoneFor(posting.created_by)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      await this.safeNotify(
        posting.created_by,
        chapterId,
        {
          title: `${name ?? 'A member'} claimed: ${posting.title}`,
          body: joinFacts(
            `Due ${formatTaskDue(posting.due_date, posting.due_at, { timeZone: posterZone })}`,
            posting.point_reward ? `${posting.point_reward} points` : null,
          ),
          priority: 'NORMAL',
          category: 'tasks',
          data: { target: { screen: 'tasks', taskId: task.id } },
        },
        posting.id,
      );
    }
    return task;
  }

  /**
   * An officer hands a posting to one active member, eligible or not. They
   * get the usual assignment push. Returns the new task.
   */
  async assign(
    chapterId: string,
    id: string,
    actorId: string,
    assigneeId: string,
  ): Promise<TaskView> {
    const posting = await this.posting(chapterId, id);
    this.assertOpen(posting);
    const reader = await this.audiences.reader(chapterId);
    if (!reader.activeIds.has(assigneeId)) {
      throw new BadRequestException(
        'Assign it to an active member of the chapter',
      );
    }
    const task = await this.take(posting, assigneeId);
    await this.tasks.notifyAssigned(task, actorId);
    return task;
  }

  /** The claim itself, its refusals answered, and the task as reads show it. */
  private async take(posting: OpenTask, assigneeId: string): Promise<TaskView> {
    const result = await this.openTaskRepo.claim(
      posting.chapter_id,
      posting.id,
      assigneeId,
      posting.created_by,
    );
    if (!result.ok) {
      if (result.reason === 'missing') {
        throw new NotFoundException('Task not found');
      }
      throw new ConflictException(TASK_AUDIENCE_COPY.alreadyClaimed);
    }
    return this.tasks.findById(result.task.id, posting.chapter_id);
  }

  /**
   * The assignee gives back a task they took from Up for grabs, before
   * they've finished it: not marked done, no points paid, no proof sent. The
   * task is deleted and its posting is open again. Returns the posting.
   */
  async release(
    chapterId: string,
    taskId: string,
    userId: string,
  ): Promise<OpenTaskView> {
    // The task's photo rows go with it; their stored objects after.
    const photos = await this.taskRepo.findPhotos(chapterId, [taskId]);
    const result = await this.openTaskRepo.release(chapterId, taskId, userId);
    if (!result.ok) {
      switch (result.reason) {
        case 'missing':
          throw new NotFoundException(
            "This task wasn't taken from Up for grabs",
          );
        case 'not_assignee':
          throw new ForbiddenException('Only its assignee can give it back');
        case 'done':
          throw new ConflictException(
            "This task is already done, so it can't go back",
          );
      }
    }
    await this.tasks.releasePhotos(
      chapterId,
      photos.map((photo) => photo.storage_path),
    );
    return this.viewOne(chapterId, result.posting, userId);
  }

  /** A member's display name for a push, or null when it cannot be read. */
  private displayNameOf(userId: string): Promise<string | null> {
    return displayNameFor(this.userRepo, userId);
  }

  private safeNotify(
    userId: string,
    chapterId: string,
    payload: NotifyPayload,
    openTaskId: string,
  ): Promise<void> {
    return notifyQuietly(this.notificationService, this.logger, {
      userId,
      chapterId,
      payload,
      site: 'open-task-notify',
      about: `open task ${openTaskId}`,
    });
  }
}
