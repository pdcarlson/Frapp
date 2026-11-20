import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type {
  ITaskRepository,
  TaskListCursor,
} from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type {
  Task,
  TaskGroup,
  TaskGroupCopyState,
  TaskGroupSummary,
  TaskPhoto,
  TaskPhotoKind,
  TaskSeriesSummary,
  TaskSubtask,
  TaskView,
} from '#domain/entities/task.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import { taskDueInstant } from '#domain/utils/member-nudge';
import {
  normalizeProofLink,
  TASK_COMPLETION_NOTE_MAX,
  TASK_PHOTOS_MAX,
  TASK_PROOF_LINK_REQUIRED_MESSAGE,
  TASK_PROOF_REQUIRED_CODE,
  TASK_PROOF_REQUIRED_MESSAGE,
  TASK_RESUBMIT_NEEDS_CHANGE_CODE,
  TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE,
  TASK_SEND_BACK_REASON_MAX,
  TASK_SUBTASKS_MAX,
  taskNeedsSignOff,
  taskSignedOffAutomatically,
  TASK_AUDIENCE_COPY,
  TASK_FOLLOWER_COPY,
  parseTaskFollower,
  type TaskAudience,
  type TaskGroupAudience,
  type TaskProofKind,
} from '@repo/validation';
import { OPEN_TASK_REPOSITORY } from '#domain/repositories/open-task.repository.interface';
import type { IOpenTaskRepository } from '#domain/repositories/open-task.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  assertUploadedPathUnder,
  assertUploadRequestAllowed,
  mintChapterUpload,
} from './chapter-upload';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';
import { ChatService } from './chat.service';
import {
  TaskAudienceService,
  type TaskAudienceTarget,
} from './task-audience.service';
import {
  checkedDueAt,
  checkedDueDate,
  checkedSubtaskTitles,
} from './task-input-checks';
import {
  formatTaskDue,
  joinFacts,
  TASK_REVIEW_PUSH_THREAD,
  taskFollowedFinishedCopy,
  taskSubmittedCopy,
} from './push-copy';
import { displayNameFor, notifyQuietly } from './task-push';
import { instantOrThrow } from './instant-bound';
import { planSeriesStart, readTaskRule } from './task-series-schedule';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** Task photos' private bucket (#4565). */
const TASKS_BUCKET = 'tasks';

/**
 * Folder holding one chapter's task photos, trailing slash included. Lowercased
 * for the same reason as the service-proof prefix: storage prefix math is
 * exact-case while the guard's uuid check is not.
 */
function taskPhotoPrefix(chapterId: string): string {
  return `chapters/${chapterId.toLowerCase()}/tasks/`;
}

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
function toDisplayStatus(task: Task, now: Date = new Date()): TaskView {
  return {
    ...task,
    status: displayStatusOf(task, now),
    stored_status: task.status,
  };
}

/** The status a client renders: `OVERDUE` for an open task past its due. */
function displayStatusOf(
  task: Pick<Task, 'status' | 'due_date' | 'due_at'>,
  now: Date,
): TaskStatus {
  return (task.status === TaskStatus.TODO ||
    task.status === TaskStatus.IN_PROGRESS) &&
    isPastDue(task, now)
    ? TaskStatus.OVERDUE
    : task.status;
}

/**
 * A task with a time is past due from that minute; one without is past due
 * from the day after `due_date` (UTC), as it always was (#4003).
 */
function isPastDue(
  task: Pick<Task, 'due_date' | 'due_at'>,
  now: Date,
): boolean {
  return taskDueInstant(task) <= now.getTime();
}

function toDisplayStatusList(tasks: Task[]): TaskView[] {
  return tasks.map((task) => toDisplayStatus(task));
}

/**
 * Narrows and pages `TaskService.list` (#4037). With no `limit` and no
 * `after`, the list is every matching task: what a build that sends no
 * parameters reads.
 */
export interface TaskListOptions {
  /** `true`: only confirmed tasks; `false`: only unconfirmed ones. */
  confirmed?: boolean;
  /** Only tasks in this stored status. */
  status?: TaskStatus;
  /** Only tasks this member created. */
  createdBy?: string;
  /** Leave out tasks assigned to this member. */
  notAssigneeId?: string;
  /** Only tasks marked done at or after this instant. */
  completedSince?: string;
  /** `newest` (default) or `longest_waiting`, as the repository orders them. */
  order?: 'newest' | 'longest_waiting';
  /** Resume after this row (the last of the page before). */
  after?: TaskListCursor;
  /** At most this many rows. */
  limit?: number;
}

/** A copy's state with its display status, as a group row reads it (#5492). */
export type TaskGroupCopyView = TaskGroupCopyState & {
  stored_status: TaskStatus;
};

/**
 * One thing a member assigned, as {@link TaskService.listAssignedItems} reads
 * it (#5492): a one-person task, or a task for everyone once, with its
 * group's progress, every copy's state and one copy whole.
 */
export type AssignedTaskItem =
  | { kind: 'task'; task: TaskView }
  | {
      kind: 'group';
      group: TaskGroupSummary;
      /** Every copy's state, with its display status, by id; never none. */
      copies: [TaskGroupCopyView, ...TaskGroupCopyView[]];
      /**
       * A copy not yet confirmed, whole: what the copies share (title,
       * description, due, points, proof) is read from it, since a group edit
       * leaves a confirmed copy as it was.
       */
      shared: Task;
      /** When the group was made. */
      created_at: string;
    };

export interface CreateTaskInput {
  chapter_id: string;
  title: string;
  description?: string | null;
  /**
   * Who the task is for. Exactly one of this, `assignee_ids` and `audience`.
   */
  assignee_id?: string | null;
  /**
   * Several people picked one by one (Paul, 2026-11-18): each gets their own
   * copy, as with `audience`. A list of one is that person's task.
   */
  assignee_ids?: string[] | null;
  /**
   * A task for a group instead of one person (#4295 step 3): each member gets
   * their own copy. Exactly one of this, `assignee_id` and `assignee_ids`.
   */
  audience?: TaskAudience | null;
  /** With `audience`: only this role's holders (2026-11-18). */
  audience_role_id?: string | null;
  /** With `audience`: only this chapter group's members (2026-11-18). */
  audience_group_id?: string | null;
  /** With `audience`: only those holding a role in this tier (#5473). */
  audience_tier_id?: string | null;
  /**
   * The tier, role or group the task is from (#5473), `tier:<id>`,
   * `role:<id>` or `group:<id>`; the creator must be in it.
   */
  followed_by?: string | null;
  created_by: string;
  due_date: string;
  /** The moment it is due, when it has a time of day. */
  due_at?: string | null;
  /** Subtask titles, in order (#4003). */
  subtasks?: string[];
  point_reward?: number | null;
  /**
   * Reference photos' storage paths, from the upload URL, in order (up to
   * 6, #4635).
   */
  reference_photo_paths?: string[];
  /** What Mark done needs (#4635). Default `none`. */
  proof_kind?: TaskProofKind;
  /**
   * The minutes the task was suggested from (#5562). Set only by accepting
   * a suggestion from minutes; never from the HTTP body.
   */
  meeting_id?: string | null;
  /**
   * Repeat on this rule (#5119): the task is the first copy of a new series,
   * and the sweep makes each next copy once the latest one is due.
   */
  recurrence_rule?: string | null;
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
  /**
   * The task's reference photos as they should stand, in order (#4635):
   * paths it already holds stay, new ones are checked and added, and any it
   * held that aren't listed are removed. `[]` removes them all.
   */
  reference_photo_paths?: string[];
  proof_kind?: TaskProofKind;
  /**
   * The tier, role or group the task is from (#5473), or null for nobody.
   * A new one must name one the editor is in.
   */
  followed_by?: string | null;
}

/** Mark done's proof and reply (#4635). Only read with `COMPLETED`. */
export interface CompletionInput {
  proof_photo_paths?: string[];
  proof_link?: string | null;
  completion_note?: string | null;
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
  photos: TaskPhoto[];
  card_posted?: boolean;
  /** On a task for everyone: its group, as reads carry it (#4295 step 3). */
  group?: TaskGroupSummary;
};

/** Copies written or pushed at once when a group task is made or edited. */
export const GROUP_NOTIFY_CONCURRENCY = 10;

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepo: ITaskRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly notificationService: NotificationService,
    private readonly chatService: ChatService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly audiences: TaskAudienceService,
    @Inject(OPEN_TASK_REPOSITORY)
    private readonly openTaskRepo: IOpenTaskRepository,
  ) {}

  /**
   * A signed upload URL for a task photo (#4565), under the chapter's
   * `tasks/` prefix: the service-hours proof flow, photos only. The same URL
   * serves a reference photo and a proof photo; the write that attaches it
   * decides which, and checks the path again there.
   */
  async requestPhotoUploadUrl(input: {
    chapterId: string;
    filename: string;
    contentType: string;
    sizeBytes?: number;
  }): Promise<{ signedUrl: string; storagePath: string }> {
    assertUploadRequestAllowed('task_photo', input);
    const ticket = await mintChapterUpload(
      this.storageProvider,
      TASKS_BUCKET,
      taskPhotoPrefix(input.chapterId),
      input,
    );
    return { signedUrl: ticket.signedUrl, storagePath: ticket.storagePath };
  }

  /** A client-sent photo path, checked like service proof before it is kept. */
  private async assertPhotoPath(
    chapterId: string,
    path: string,
    field: string,
  ): Promise<void> {
    await assertUploadedPathUnder(
      this.storageProvider,
      TASKS_BUCKET,
      taskPhotoPrefix(chapterId),
      path,
      {
        field,
        outsidePrefix: `${field} must be a storage path within the chapter's task photos`,
        missing: `${field} does not reference an uploaded photo`,
      },
    );
    if (await this.taskRepo.isPhotoPathInUse(chapterId, path)) {
      throw new BadRequestException(
        `${field} is already attached to a task; upload the photo again`,
      );
    }
  }

  /**
   * Client-sent photo paths for one kind (#4635): trimmed, duplicates
   * dropped, at most `TASK_PHOTOS_MAX`, and each checked like service proof.
   * `held` are paths this task already holds for the kind, which stay without
   * a second check.
   */
  private async checkedPhotoPaths(
    chapterId: string,
    paths: string[],
    field: string,
    held: ReadonlySet<string> = new Set(),
  ): Promise<string[]> {
    const unique = [
      ...new Set(paths.map((path) => path.trim()).filter(Boolean)),
    ];
    if (unique.length > TASK_PHOTOS_MAX) {
      throw new BadRequestException(
        `${field} takes at most ${TASK_PHOTOS_MAX} photos`,
      );
    }
    await Promise.all(
      unique
        .filter((path) => !held.has(path))
        .map((path) => this.assertPhotoPath(chapterId, path, field)),
    );
    return unique;
  }

  /**
   * A short-lived link to one of a task's photos, for whoever may read the
   * task (its assignee, a `tasks:manage` holder, or for a reference photo a
   * member of its following group, #5473; the controller checks).
   */
  async getPhotoDownloadUrl(
    taskId: string,
    chapterId: string,
    photoId: string,
  ): Promise<{ url: string }> {
    const [photo] = (
      await this.taskRepo.findPhotos(chapterId, [taskId])
    ).filter((row) => row.id === photoId);
    // Only paths this API minted and checked are ever stored, but sign
    // nothing outside the chapter's prefix regardless.
    if (!photo || !photo.storage_path.startsWith(taskPhotoPrefix(chapterId))) {
      throw new NotFoundException('This task has no such photo');
    }
    try {
      const url = await this.storageProvider.getSignedDownloadUrl(
        TASKS_BUCKET,
        photo.storage_path,
      );
      return { url };
    } catch (error) {
      if (/not.?found/i.test(String((error as Error)?.message))) {
        throw new NotFoundException('This photo is no longer available');
      }
      throw error;
    }
  }

  /**
   * Remove photo rows a write let go of, then their stored objects. Best
   * effort once the write stands: a failure is reported, never thrown, and
   * leaves an orphan for the sweep (#2197).
   */
  private async dropPhotos(
    chapterId: string,
    taskId: string,
    photos: TaskPhoto[],
  ): Promise<void> {
    if (photos.length === 0) return;
    let removed: TaskPhoto[] = [];
    try {
      removed = await this.taskRepo.deletePhotos(
        chapterId,
        taskId,
        photos.map((photo) => photo.id),
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'task-photo-delete',
        message: `task photo rows delete failed for task ${taskId}`,
        error,
      });
      return;
    }
    await this.releasePhotos(
      chapterId,
      removed.map((photo) => photo.storage_path),
    );
  }

  /** Photo rows for new paths of one kind, positioned after `from`. */
  private photoRows(
    task: Pick<Task, 'id' | 'chapter_id'>,
    kind: TaskPhotoKind,
    paths: string[],
    createdBy: string,
    from = 0,
  ) {
    return paths.map((storage_path, index) => ({
      task_id: task.id,
      chapter_id: task.chapter_id,
      kind,
      storage_path,
      position: from + index,
      created_by: createdBy,
    }));
  }

  /**
   * Delete photos a write has just let go of. Best effort: the write already
   * stands, so a failed delete leaves an orphan for the sweep (#2197) and is
   * reported, never thrown. Also after a task given back to Up for grabs is
   * deleted (`OpenTaskService.release`).
   */
  async releasePhotos(
    chapterId: string,
    paths: (string | null | undefined)[],
  ): Promise<void> {
    const prefix = taskPhotoPrefix(chapterId);
    const owned = paths.filter(
      (path): path is string => !!path && path.startsWith(prefix),
    );
    if (owned.length === 0) return;
    try {
      await this.storageProvider.deleteFiles(TASKS_BUCKET, owned);
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'task-photo-delete',
        message: `task photo delete failed (${owned.length} object(s))`,
        error,
      });
    }
  }

  async findById(id: string, chapterId: string): Promise<TaskView> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const [view] = await this.withSubtasks(chapterId, [toDisplayStatus(task)]);
    return view;
  }

  /**
   * Whether each of these tasks is done, by task id, in two reads whatever
   * the count: a task for everyone is done once every copy is (#4295 step 3),
   * and comes with its counts. Tasks that no longer exist are left out. For
   * the checkboxes on posted minutes, which show nothing else of the task.
   */
  async doneMarks(
    chapterId: string,
    ids: string[],
  ): Promise<
    Map<
      string,
      { done: boolean; group: { done: number; total: number } | null }
    >
  > {
    const tasks = await this.taskRepo.findByIds(chapterId, [...new Set(ids)]);
    const groups = await this.groupSummaries(chapterId, tasks);
    const marks = new Map<
      string,
      { done: boolean; group: { done: number; total: number } | null }
    >();
    for (const task of tasks) {
      const summary = task.group_id ? groups.get(task.group_id) : undefined;
      const group = summary
        ? { done: summary.done, total: summary.total }
        : null;
      marks.set(task.id, {
        done: group
          ? group.total > 0 && group.done >= group.total
          : task.status === TaskStatus.COMPLETED,
        group,
      });
    }
    return marks;
  }

  /**
   * The chapter's tasks due or made since the given days, whole and without
   * their subtasks: for a background read of the record (#3930), never a
   * member's list.
   */
  async listSince(
    chapterId: string,
    since: { dueFrom: string; createdFrom: string },
  ): Promise<TaskView[]> {
    const tasks = await this.taskRepo.findSince(chapterId, since);
    return tasks.map((task) => toDisplayStatus(task));
  }

  /** Each task with its subtasks and photos, in order (#4003, #4635). */
  private async withSubtasks(
    chapterId: string,
    tasks: TaskView[],
  ): Promise<TaskView[]> {
    if (tasks.length === 0) return tasks;
    const ids = tasks.map((task) => task.id);
    const [subtasks, withPhotos, series, groups, claimedFrom, followers] =
      await Promise.all([
        this.taskRepo.findSubtasks(chapterId, ids),
        this.withPhotos(chapterId, tasks),
        this.seriesSummaries(chapterId, tasks),
        this.groupSummaries(chapterId, tasks),
        this.openTaskRepo.findClaimedFrom(chapterId, ids),
        this.followerNames(chapterId, tasks),
      ]);
    const byTask = new Map<string, TaskSubtask[]>();
    for (const subtask of subtasks) {
      const list = byTask.get(subtask.task_id) ?? [];
      list.push(subtask);
      byTask.set(subtask.task_id, list);
    }
    return withPhotos.map((task) => ({
      ...task,
      subtasks: byTask.get(task.id) ?? [],
      series: task.series_id ? (series.get(task.series_id) ?? null) : null,
      group: task.group_id ? (groups.get(task.group_id) ?? null) : null,
      open_task_id: claimedFrom.get(task.id) ?? null,
      followed_by_name: task.followed_by
        ? (followers.get(task.followed_by) ?? null)
        : null,
    }));
  }

  /**
   * The live name of each task's following tier, role or group, by entry
   * (#5473); one since deleted is absent. No read when none follows.
   */
  private async followerNames(
    chapterId: string,
    tasks: Task[],
  ): Promise<Map<string, string>> {
    const ids = {
      roleIds: [] as string[],
      groupIds: [] as string[],
      tierIds: [] as string[],
    };
    const entries = new Set<string>();
    for (const task of tasks) {
      const parsed = parseTaskFollower(task.followed_by);
      if (!parsed || entries.has(task.followed_by ?? '')) continue;
      entries.add(task.followed_by ?? '');
      ids[`${parsed.kind}Ids`].push(parsed.id);
    }
    const byEntry = new Map<string, string>();
    if (entries.size === 0) return byEntry;
    const names = await this.audiences.liveNames(chapterId, ids);
    for (const entry of entries) {
      const parsed = parseTaskFollower(entry);
      const name = parsed ? names.get(parsed.id) : undefined;
      if (name) byEntry.set(entry, name);
    }
    return byEntry;
  }

  /**
   * How far each task's group is, by group id (#4295 step 3): its copies
   * counted, done (marked done, confirmed or not) and confirmed.
   */
  private async groupSummaries(
    chapterId: string,
    tasks: Task[],
  ): Promise<Map<string, TaskGroupSummary>> {
    const ids = [
      ...new Set(
        tasks.flatMap((task) => (task.group_id ? [task.group_id] : [])),
      ),
    ];
    if (ids.length === 0) return new Map();
    const [groups, copies] = await Promise.all([
      this.taskRepo.findGroups(chapterId, ids),
      this.taskRepo.findGroupCopyStates(chapterId, ids),
    ]);
    return this.summarize(chapterId, groups, copies);
  }

  /**
   * {@link groupSummaries} from groups and their copies already read, plus a
   * read of the live names when any group went to a role or chapter group.
   */
  private async summarize(
    chapterId: string,
    groups: TaskGroup[],
    copies: Pick<Task, 'group_id' | 'status' | 'points_awarded'>[],
  ): Promise<Map<string, TaskGroupSummary>> {
    const summaries = new Map<string, TaskGroupSummary>();
    if (groups.length === 0) return summaries;
    // A role's or group's name as it reads now; the one it had when the task
    // was made once it's deleted (2026-11-18).
    const targetsOf = (audience: TaskGroupAudience) => [
      ...new Set(
        groups.flatMap((group) =>
          group.audience === audience && group.target_id
            ? [group.target_id]
            : [],
        ),
      ),
    ];
    const roleIds = targetsOf('role');
    const groupIds = targetsOf('group');
    const tierIds = targetsOf('tier');
    const names =
      roleIds.length > 0 || groupIds.length > 0 || tierIds.length > 0
        ? await this.audiences.liveNames(chapterId, {
            roleIds,
            groupIds,
            tierIds,
          })
        : new Map<string, string>();
    for (const group of groups) {
      summaries.set(group.id, {
        id: group.id,
        audience: group.audience,
        target_id: group.target_id ?? null,
        target_name: group.target_id
          ? (names.get(group.target_id) ?? group.target_name ?? null)
          : null,
        total: 0,
        done: 0,
        confirmed: 0,
      });
    }
    for (const copy of copies) {
      const summary = copy.group_id ? summaries.get(copy.group_id) : undefined;
      if (!summary) continue;
      summary.total += 1;
      if (copy.status === TaskStatus.COMPLETED) summary.done += 1;
      if (copy.points_awarded) summary.confirmed += 1;
    }
    return summaries;
  }

  /** How each task's series repeats, by series id (#5119). */
  private async seriesSummaries(
    chapterId: string,
    tasks: Task[],
  ): Promise<Map<string, TaskSeriesSummary>> {
    const ids = [
      ...new Set(
        tasks.flatMap((task) => (task.series_id ? [task.series_id] : [])),
      ),
    ];
    const summaries = new Map<string, TaskSeriesSummary>();
    if (ids.length === 0) return summaries;
    for (const series of await this.taskRepo.findSeries(chapterId, ids)) {
      summaries.set(series.id, {
        recurrence_rule: series.recurrence_rule,
        next_due_date: series.next_due_date,
        ended: series.ended_at !== null,
      });
    }
    return summaries;
  }

  /**
   * Each task with its photos (#4635): reference photos, then proof photos,
   * each in order. A status write returns these too, so the officer's card
   * shows the proof that came with a completion.
   */
  private async withPhotos(
    chapterId: string,
    tasks: TaskView[],
  ): Promise<TaskView[]> {
    if (tasks.length === 0) return tasks;
    const photos = await this.taskRepo.findPhotos(
      chapterId,
      tasks.map((task) => task.id),
    );
    const byTask = new Map<string, TaskPhoto[]>();
    for (const photo of photos) {
      const list = byTask.get(photo.task_id) ?? [];
      list.push(photo);
      byTask.set(photo.task_id, list);
    }
    const order = (photo: TaskPhoto) => (photo.kind === 'reference' ? 0 : 1);
    return tasks.map((task) => ({
      ...task,
      photos: (byTask.get(task.id) ?? []).sort(
        (a, b) => order(a) - order(b) || a.position - b.position,
      ),
    }));
  }

  /** One task as a write returns it: display status and its photos. */
  private async viewWithPhotos(
    chapterId: string,
    task: Task,
  ): Promise<TaskView> {
    const [view] = await this.withPhotos(chapterId, [toDisplayStatus(task)]);
    return view;
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
    const [clean] = checkedSubtaskTitles([title]);
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

  /** A member's display name for a push, or null when it cannot be read. */
  private displayNameOf(userId: string): Promise<string | null> {
    return displayNameFor(this.userRepo, userId);
  }

  /**
   * The chapter's tasks for a `tasks:manage` holder, otherwise the caller's
   * own, newest first, narrowed and paged by `options` (#4037).
   */
  async list(
    chapterId: string,
    userId: string,
    isAdmin: boolean,
    options: TaskListOptions = {},
    /**
     * The follower entries the caller is in (#5473,
     * `TaskAudienceService.followEntriesOf`): a member's list then also holds
     * the tasks those follow, without their proof. Only the board's read
     * passes them; Activity's "my tasks" reads don't.
     */
    follows: readonly string[] = [],
  ): Promise<TaskView[]> {
    // The regex on the DTO lets a calendar-invalid instant (2026-02-30)
    // through, and Postgres would answer it with a 500.
    instantOrThrow('before', options.after?.created_at);
    const tasks = await this.taskRepo.findByChapter(chapterId, {
      ...options,
      // Last, so no option widens a member's read past their own tasks and
      // the ones their groups follow.
      ...(isAdmin
        ? {}
        : {
            assigneeId: userId,
            ...(follows.length > 0 ? { orFollowedBy: follows } : {}),
          }),
    });
    const views = await this.withSubtasks(
      chapterId,
      toDisplayStatusList(tasks),
    );
    return isAdmin
      ? views
      : views.map((view) => this.asReadBy(view, userId, false));
  }

  /**
   * Whether a member may read a task (#5473): its assignee, a `tasks:manage`
   * holder, or someone in the tier, role or group that follows it, read now.
   */
  async mayRead(
    task: Pick<Task, 'assignee_id' | 'followed_by'>,
    chapterId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<boolean> {
    if (isAdmin || task.assignee_id === userId) return true;
    if (!task.followed_by) return false;
    const follows = await this.audiences.followEntriesOf(chapterId, userId);
    return follows.includes(task.followed_by);
  }

  /** The follower entries a member is in now (#5473). */
  followEntriesOf(chapterId: string, userId: string): Promise<string[]> {
    return this.audiences.followEntriesOf(chapterId, userId);
  }

  /**
   * A task as one reader sees it (#5473): whole for its assignee and a
   * `tasks:manage` holder; for a follower, without its proof (the proof
   * photos and link), the assignee's reply or an officer's send-back
   * reason, which stay between the assignee and the officers.
   */
  asReadBy<T extends TaskView>(view: T, userId: string, isAdmin: boolean): T {
    if (isAdmin || view.assignee_id === userId) return view;
    // The assignee's reply and an officer's send-back reason are theirs too
    // (§ Photos, § Admin Confirmation): shown to the assignee and officers.
    return {
      ...view,
      proof_link: null,
      completion_note: null,
      sent_back_reason: null,
      ...(view.photos
        ? { photos: view.photos.filter((photo) => photo.kind === 'reference') }
        : {}),
    };
  }

  /** How many tasks {@link list} would return with no `limit`, counted in SQL. */
  async count(
    chapterId: string,
    userId: string,
    isAdmin: boolean,
    options: Pick<
      TaskListOptions,
      'confirmed' | 'status' | 'createdBy' | 'notAssigneeId' | 'completedSince'
    > = {},
  ): Promise<number> {
    return this.taskRepo.countByChapter(chapterId, {
      ...options,
      ...(isAdmin ? {} : { assigneeId: userId }),
    });
  }

  /**
   * What `createdBy` assigned that isn't finished, newest first, at most
   * `limit`, a task for everyone counted once however many copies it has
   * (#5492): their one-person tasks not yet confirmed and their groups with a
   * copy not yet confirmed, each read newest first and capped in SQL, then
   * merged and cut. For the groups that made the cut it reads every copy's
   * state (a few columns each, batched by group and paged, so a group of any
   * size is read whole), then one unconfirmed copy of each, whole, for what
   * the copies share; `summarize` adds a read of role and chapter-group names
   * when a group went to one. No read is made per group. Only for a
   * `tasks:manage` holder: it reads tasks the caller doesn't hold.
   */
  async listAssignedItems(
    chapterId: string,
    createdBy: string,
    limit: number,
    now: Date = new Date(),
  ): Promise<AssignedTaskItem[]> {
    const [singles, groups] = await Promise.all([
      this.taskRepo.findByChapter(chapterId, {
        createdBy,
        groupless: true,
        confirmed: false,
        limit,
      }),
      this.taskRepo.findUnfinishedGroupsByCreator(chapterId, createdBy, limit),
    ]);
    type Entry =
      { kind: 'task'; row: Task } | { kind: 'group'; row: TaskGroup };
    // Newest first, then the higher id, the order each list was read in.
    const newest = (a: Entry, b: Entry) =>
      Date.parse(b.row.created_at) - Date.parse(a.row.created_at) ||
      b.row.id.localeCompare(a.row.id);
    const kept = [
      ...singles.map((row): Entry => ({ kind: 'task', row })),
      ...groups.map((row): Entry => ({ kind: 'group', row })),
    ]
      .sort(newest)
      .slice(0, limit);

    const keptGroups = kept.flatMap((entry) =>
      entry.kind === 'group' ? [entry.row] : [],
    );
    const states =
      keptGroups.length > 0
        ? await this.taskRepo.findGroupCopyStates(
            chapterId,
            keptGroups.map((group) => group.id),
          )
        : [];
    const copiesOf = new Map<string, TaskGroupCopyView[]>();
    for (const state of states) {
      if (!state.group_id) continue;
      const list = copiesOf.get(state.group_id) ?? [];
      list.push({
        ...state,
        status: displayStatusOf(state, now),
        stored_status: state.status,
      });
      copiesOf.set(state.group_id, list);
    }
    // One copy not yet confirmed per group, read whole for what they share.
    const sharedIds = [...copiesOf.values()].flatMap((copies) => {
      const open = copies.find((copy) => !copy.points_awarded);
      return open ? [open.id] : [];
    });
    const [summaries, sharedRows] = await Promise.all([
      this.summarize(chapterId, keptGroups, states),
      sharedIds.length > 0
        ? this.taskRepo.findByIds(chapterId, sharedIds)
        : Promise.resolve([]),
    ]);
    const sharedOf = new Map(
      sharedRows.flatMap((row) => (row.group_id ? [[row.group_id, row]] : [])),
    );

    return kept.flatMap((entry): AssignedTaskItem[] => {
      if (entry.kind === 'task') {
        return [
          {
            kind: 'task',
            task: { ...toDisplayStatus(entry.row, now), group: null },
          },
        ];
      }
      const summary = summaries.get(entry.row.id);
      const [first, ...rest] = copiesOf.get(entry.row.id) ?? [];
      const shared = sharedOf.get(entry.row.id);
      // Its last open copy confirmed (or deleted) between the reads: it is
      // finished now, as the SQL filter would have found.
      if (!summary || !first || !shared || summary.confirmed >= summary.total) {
        return [];
      }
      return [
        {
          kind: 'group',
          group: summary,
          copies: [first, ...rest],
          shared,
          created_at: entry.row.created_at,
        },
      ];
    });
  }

  async create(input: CreateTaskInput): Promise<CreateTaskResult> {
    const people = [...new Set(input.assignee_ids ?? [])];
    const answers = [
      !!input.assignee_id,
      input.assignee_ids != null,
      !!input.audience,
    ].filter(Boolean).length;
    if (answers > 1) {
      throw new BadRequestException(
        'Send one of assignee_id, assignee_ids or audience',
      );
    }
    const narrowed = [
      input.audience_role_id,
      input.audience_group_id,
      input.audience_tier_id,
    ].filter(Boolean).length;
    if (narrowed > 0 && !input.audience) {
      throw new BadRequestException(
        'audience_role_id, audience_group_id and audience_tier_id go with audience',
      );
    }
    if (narrowed > 1) {
      throw new BadRequestException(
        'Send one of audience_role_id, audience_group_id and audience_tier_id',
      );
    }
    if (input.followed_by && input.recurrence_rule != null) {
      throw new BadRequestException(TASK_FOLLOWER_COPY.noRepeat);
    }
    const followedBy = input.followed_by
      ? await this.audiences.checkedFollower(
          input.chapter_id,
          input.created_by,
          input.followed_by,
        )
      : null;
    if (input.audience) {
      return this.createForGroup(
        input,
        input.audience_role_id
          ? { kind: 'role', id: input.audience_role_id }
          : input.audience_group_id
            ? { kind: 'group', id: input.audience_group_id }
            : input.audience_tier_id
              ? { kind: 'tier', id: input.audience_tier_id }
              : { kind: 'chapter' },
        followedBy,
      );
    }
    if (input.assignee_ids != null && people.length !== 1) {
      return this.createForGroup(
        input,
        { kind: 'people', userIds: people },
        followedBy,
      );
    }
    const assigneeId = input.assignee_id ?? people[0];
    if (!assigneeId) {
      throw new BadRequestException('A task needs an assignee');
    }
    // A list of one is that person's task, held to the list's rule: active
    // members only, as two or more are (`TaskAudienceReader.resolve`).
    if (
      input.assignee_ids != null &&
      !(await this.audiences.reader(input.chapter_id)).activeIds.has(assigneeId)
    ) {
      throw new BadRequestException(
        'Everyone you pick must be an active member of the chapter',
      );
    }
    checkedDueDate(input.due_date);
    const dueAt = checkedDueAt(input.due_date, input.due_at);
    const subtaskTitles = checkedSubtaskTitles(input.subtasks ?? []);
    const referencePhotos = await this.checkedPhotoPaths(
      input.chapter_id,
      input.reference_photo_paths ?? [],
      'reference_photo_paths',
    );

    const assignee = await this.memberRepo.findByUserAndChapter(
      assigneeId,
      input.chapter_id,
    );
    if (!assignee) {
      throw new BadRequestException('Assignee must be a member of the chapter');
    }

    const repeat = this.checkedRepeat(input, dueAt);
    const task = repeat
      ? await this.taskRepo.createSeries({
          chapter_id: input.chapter_id,
          created_by: input.created_by,
          title: input.title,
          description: input.description ?? null,
          assignee_id: assigneeId,
          point_reward: input.point_reward ?? null,
          proof_kind: input.proof_kind ?? 'none',
          subtask_titles: subtaskTitles,
          due_time: repeat.due_time,
          recurrence_rule: repeat.rule,
          first_due_date: input.due_date.slice(0, 10),
          first_due_at: dueAt,
          latest_due_at: repeat.latest_due_at,
          next_due_date: repeat.next_due_date,
        })
      : await this.taskRepo.create({
          chapter_id: input.chapter_id,
          title: input.title,
          description: input.description ?? null,
          assignee_id: assigneeId,
          created_by: input.created_by,
          due_date: input.due_date,
          due_at: dueAt,
          status: TaskStatus.TODO,
          point_reward: input.point_reward ?? null,
          points_awarded: false,
          completed_at: null,
          confirmed_at: null,
          proof_kind: input.proof_kind ?? 'none',
          ...(input.meeting_id ? { meeting_id: input.meeting_id } : {}),
          ...(followedBy ? { followed_by: followedBy } : {}),
        });

    // Reference photos go in after their task, like the checklist below. A
    // failed insert is reported and the create stands; the officer sees no
    // photos and can add them from the task.
    let photos: TaskPhoto[] = [];
    if (referencePhotos.length > 0) {
      try {
        photos = await this.taskRepo.createPhotos(
          this.photoRows(task, 'reference', referencePhotos, input.created_by),
        );
      } catch (error) {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'task-photos-create',
          message: `reference photo insert failed for task ${task.id}`,
          error,
        });
      }
    }

    // The checklist goes in after its task. A failed insert is reported and
    // the create still succeeds: the task exists, and failing the request
    // would invite a retry that makes a second one. The officer sees a task
    // with no subtasks and can add them from it. A series' first copy got its
    // checklist in the same transaction (#5119).
    if (subtaskTitles.length > 0 && !repeat) {
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
      ? { ...task, photos }
      : { ...task, photos, card_posted: cardPosted };
  }

  /**
   * A task for everyone (#4295 step 3; Paul 2026-11-17, "one group task, a
   * copy each"): a copy per active member, the chapter minus its alumni
   * (`spec/behavior/alumni.md`), the officer included when they are one. Or,
   * since 2026-11-18, for everyone holding a role, everyone in a chapter
   * group, or several people picked one by one (`TaskAudienceService`; the
   * group keeps the role's or group's id and its name as it was). The
   * group, the copies and their checklists are written in one transaction,
   * then each member gets the usual assignment push (none to the officer for
   * their own copy). It can't repeat, carry reference photos (one stored photo
   * belongs to one task) or post a chat card yet. Returns the officer's own
   * copy when they have one, otherwise the first, with the group's summary.
   */
  private async createForGroup(
    input: CreateTaskInput,
    target: TaskAudienceTarget,
    followedBy: string | null,
  ): Promise<CreateTaskResult> {
    checkedDueDate(input.due_date);
    if (input.recurrence_rule != null) {
      throw new BadRequestException(TASK_AUDIENCE_COPY.noRepeat);
    }
    if ((input.reference_photo_paths ?? []).length > 0) {
      throw new BadRequestException(TASK_AUDIENCE_COPY.noPhotos);
    }
    if (input.channel_id || input.client_message_id) {
      throw new BadRequestException(
        "A task for everyone can't be posted to chat yet",
      );
    }
    const dueAt = checkedDueAt(input.due_date, input.due_at);
    const subtaskTitles = checkedSubtaskTitles(input.subtasks ?? []);
    const reader = await this.audiences.reader(input.chapter_id);
    const resolved = await reader.resolve(target);
    const audience: TaskGroupAudience =
      resolved.kind === 'chapter' ? 'everyone' : resolved.kind;

    const copies = await this.taskRepo.createGroup({
      chapter_id: input.chapter_id,
      created_by: input.created_by,
      audience,
      target_id: resolved.targetId,
      target_name: resolved.targetName,
      assignee_ids: resolved.userIds,
      title: input.title,
      description: input.description ?? null,
      due_date: input.due_date,
      due_at: dueAt,
      point_reward: input.point_reward ?? null,
      proof_kind: input.proof_kind ?? 'none',
      subtask_titles: subtaskTitles,
      ...(input.meeting_id ? { meeting_id: input.meeting_id } : {}),
      followed_by: followedBy,
    });

    // `notifyAssigned` reports its own failures, so one member's push can't
    // stop the rest.
    for (let i = 0; i < copies.length; i += GROUP_NOTIFY_CONCURRENCY) {
      await Promise.all(
        copies
          .slice(i, i + GROUP_NOTIFY_CONCURRENCY)
          .map((copy) => this.notifyAssigned(copy, input.created_by)),
      );
    }

    const own =
      copies.find((copy) => copy.assignee_id === input.created_by) ?? copies[0];
    return {
      ...own,
      photos: [],
      group: {
        id: own.group_id ?? '',
        audience,
        target_id: resolved.targetId,
        target_name: resolved.targetName,
        total: copies.length,
        done: 0,
        confirmed: 0,
      },
    };
  }

  /** A copy of a group task, and its group; a 404 or a 400 otherwise. */
  private async groupCopyOrThrow(
    id: string,
    chapterId: string,
  ): Promise<{ task: Task; groupId: string }> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) throw new NotFoundException('Task not found');
    if (!task.group_id) {
      throw new BadRequestException("This task isn't for a group");
    }
    return { task, groupId: task.group_id };
  }

  /**
   * An officer's edit of everyone's copy of a group task (#4295 step 3): the
   * same edit as {@link update}, made to each copy not yet confirmed. A
   * confirmed copy's points were paid on it as it stood, so it stays, as one
   * task does. Who it is for and its photos change per copy only. Returns
   * the copy it was asked on.
   */
  async updateGroup(
    id: string,
    chapterId: string,
    actorId: string,
    input: UpdateTaskInput,
  ): Promise<TaskView> {
    const { task, groupId } = await this.groupCopyOrThrow(id, chapterId);
    if (input.assignee_id !== undefined) {
      throw new BadRequestException(
        "Hand one member's copy to someone else on that copy alone",
      );
    }
    if (input.reference_photo_paths !== undefined) {
      throw new BadRequestException(TASK_AUDIENCE_COPY.noPhotos);
    }
    const { followed_by, ...rest } = input;
    // Checked first, written last: an edit refused below changes nothing.
    // Every copy, confirmed ones too: the group follows as one task.
    const nextFollower =
      followed_by === undefined
        ? undefined
        : await this.checkedFollowerEdit(task, chapterId, actorId, followed_by);
    const writeFollower = async () => {
      if (nextFollower !== undefined && nextFollower !== task.followed_by) {
        await this.taskRepo.setGroupFollower(chapterId, groupId, nextFollower);
      }
    };
    if (Object.values(rest).every((value) => value === undefined)) {
      await writeFollower();
      return this.findById(id, chapterId);
    }
    input = rest;
    const open = (
      await this.taskRepo.findGroupCopies(chapterId, [groupId])
    ).filter((copy) => !copy.points_awarded);
    if (open.length === 0) {
      throw new BadRequestException(
        'Every copy is already confirmed, so none can change',
      );
    }
    // Each copy its own compare-and-set, a few at a time: a confirm that
    // lands on one mid-edit wins there, and the rest still take the edit. A
    // copy that fails otherwise doesn't stop the others; the first such
    // failure is thrown once all have been tried, and saving again reaches
    // the copies it missed (a copy already edited has nothing to change).
    const failures: Error[] = [];
    for (let i = 0; i < open.length; i += GROUP_NOTIFY_CONCURRENCY) {
      const batch = open.slice(i, i + GROUP_NOTIFY_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((copy) => this.applyEdit(copy, chapterId, actorId, input)),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') return;
        const error: unknown = result.reason;
        const raceLost =
          batch[index].id !== id &&
          error instanceof BadRequestException &&
          /confirmed/.test(error.message);
        if (raceLost) return;
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }
    if (failures.length > 0) throw failures[0];
    await writeFollower();
    return this.findById(id, chapterId);
  }

  /**
   * Delete every copy of a group task, and the group (#4295 step 3), as
   * {@link delete} deletes one task: its photos go after it.
   */
  async deleteGroup(id: string, chapterId: string): Promise<void> {
    const { groupId } = await this.groupCopyOrThrow(id, chapterId);
    const copies = await this.taskRepo.findGroupCopies(chapterId, [groupId]);
    const photos = await this.taskRepo.findPhotos(
      chapterId,
      copies.map((copy) => copy.id),
    );
    await this.taskRepo.deleteGroup(chapterId, groupId);
    await this.releasePhotos(
      chapterId,
      photos.map((photo) => photo.storage_path),
    );
  }

  /**
   * Take members out of a group task (#5492): their copies go, everyone
   * else's stay. An officer who sent a task to everyone by mistake trims it
   * to the members it is for, so the rest aren't handed work that drowns
   * out what matters to them (Paul, 2026-11-18).
   *
   * A confirmed copy stays, its points paid on it as it stood, the rule
   * {@link updateGroup} keeps: asking for one is a 400, and one confirmed
   * between the read and the delete is left by the delete's own filter. A
   * member with no copy is no error, so a retry after a partial failure
   * finishes the job. Taking out every copy is a 400: that is deleting the
   * task, which says so. Returns the group as it now stands.
   */
  async removeFromGroup(
    id: string,
    chapterId: string,
    assigneeIds: string[],
  ): Promise<{ removed: string[]; group: TaskGroupSummary }> {
    const { task, groupId } = await this.groupCopyOrThrow(id, chapterId);
    const copies = await this.taskRepo.findGroupCopies(chapterId, [groupId]);
    const asked = new Set(assigneeIds);
    const picked = copies.filter((copy) => asked.has(copy.assignee_id));
    if (picked.some((copy) => copy.points_awarded)) {
      throw new BadRequestException(
        'A confirmed copy stays: its points were paid on it',
      );
    }
    if (picked.length > 0 && picked.length === copies.length) {
      throw new BadRequestException(
        'That is everyone: delete the task for everyone instead',
      );
    }
    const photos = await this.taskRepo.findPhotos(
      chapterId,
      picked.map((copy) => copy.id),
    );
    const removedIds = await this.taskRepo.deleteGroupCopies(
      chapterId,
      groupId,
      picked.map((copy) => copy.id),
    );
    const removedSet = new Set(removedIds);
    await this.releasePhotos(
      chapterId,
      photos
        .filter((photo) => removedSet.has(photo.task_id))
        .map((photo) => photo.storage_path),
    );
    // Read again, not counted from `copies`: a confirm or a done that
    // landed meanwhile shows in the counts the client redraws from.
    const summary = (await this.groupSummaries(chapterId, [task])).get(groupId);
    if (!summary) throw new NotFoundException('Task not found');
    return {
      removed: picked
        .filter((copy) => removedSet.has(copy.id))
        .map((copy) => copy.assignee_id),
      group: summary,
    };
  }

  /**
   * A new task's repeat (#5119): its rule, checked, and the schedule its
   * series starts with. Null for a task that doesn't repeat.
   */
  private checkedRepeat(input: CreateTaskInput, dueAt: string | null) {
    // Null, like omitted, is a task that doesn't repeat.
    if (input.recurrence_rule == null) return null;
    const rule = readTaskRule(input.recurrence_rule);
    if (!rule) throw new BadRequestException("That repeat rule can't be read");
    const start = planSeriesStart(rule, input.due_date.slice(0, 10), dueAt);
    if (!start) {
      throw new BadRequestException(
        'The end date leaves no task after the first. Choose a later end date',
      );
    }
    return { rule: input.recurrence_rule, ...start };
  }

  /**
   * Tell a task's assignee it is theirs, named for the task with who assigned
   * it, when it is due and its points. Assigning yourself a task is a note to
   * self, so the push would only echo the tap that made it. Also each new
   * copy of a repeating task (#5119), from its series' creator.
   */
  async notifyAssigned(task: Task, assignerId: string): Promise<void> {
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
    // A group follows as one task (#5473): who it is from changes on every
    // copy with `scope: "group"`, never on one member's copy.
    if (task.group_id && input.followed_by !== undefined) {
      throw new BadRequestException(
        'Change who a group task is from on every copy, with scope "group"',
      );
    }
    const updated = await this.applyEdit(task, chapterId, actorId, input);
    const [view] = await this.withSubtasks(chapterId, [
      toDisplayStatus(updated),
    ]);
    return view;
  }

  /**
   * A follower an edit sends (#5473): null clears it, the task's own stays
   * as it is whoever edits, and a new one must name a tier, role or group
   * the editor is in.
   */
  private async checkedFollowerEdit(
    task: Task,
    chapterId: string,
    actorId: string,
    followedBy: string | null,
  ): Promise<string | null> {
    if (!followedBy) return null;
    if (followedBy.toLowerCase() === task.followed_by) return task.followed_by;
    if (task.series_id) {
      throw new BadRequestException(TASK_FOLLOWER_COPY.noRepeat);
    }
    return this.audiences.checkedFollower(chapterId, actorId, followedBy);
  }

  /**
   * One task's edit, read from the row as given: the write and its side
   * effects, without the view. `update` reads the row first; a group edit
   * passes the copies it already read.
   */
  private async applyEdit(
    task: Task,
    chapterId: string,
    actorId: string,
    input: UpdateTaskInput,
  ): Promise<Task> {
    const id = task.id;
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
      checkedDueDate(dueDate);
      const dueAt = checkedDueAt(
        dueDate,
        input.due_at === undefined ? task.due_at : input.due_at,
      );
      const storedAt = task.due_at ? new Date(task.due_at).toISOString() : null;
      if (dueDate !== task.due_date.slice(0, 10)) patch.due_date = dueDate;
      if (dueAt !== storedAt) patch.due_at = dueAt;
    }

    if (
      input.proof_kind !== undefined &&
      input.proof_kind !== task.proof_kind
    ) {
      patch.proof_kind = input.proof_kind;
    }

    if (input.followed_by !== undefined) {
      const next = await this.checkedFollowerEdit(
        task,
        chapterId,
        actorId,
        input.followed_by,
      );
      if (next !== task.followed_by) patch.followed_by = next;
    }

    // Photos live in their own rows (#4635): read them once for the
    // reference set below and the proof a hand-over drops.
    const reassigned =
      input.assignee_id !== undefined && input.assignee_id !== task.assignee_id;
    const held =
      input.reference_photo_paths !== undefined || reassigned
        ? await this.taskRepo.findPhotos(chapterId, [id])
        : [];
    const heldReference = held.filter((photo) => photo.kind === 'reference');
    let addReference: string[] = [];
    let dropReference: TaskPhoto[] = [];
    if (input.reference_photo_paths !== undefined) {
      const heldPaths = new Set(heldReference.map((p) => p.storage_path));
      const wanted = await this.checkedPhotoPaths(
        chapterId,
        input.reference_photo_paths,
        'reference_photo_paths',
        heldPaths,
      );
      addReference = wanted.filter((path) => !heldPaths.has(path));
      dropReference = heldReference.filter(
        (photo) => !wanted.includes(photo.storage_path),
      );
    }
    const photosChange = addReference.length > 0 || dropReference.length > 0;

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
      patch.completed_by = null;
      patch.sent_back_at = null;
      // The old assignee's proof, link, reply and send-back aren't the new
      // one's (#4635).
      patch.sent_back_reason = null;
      patch.proof_link = null;
      patch.completion_note = null;
    }

    // A completion still waiting on an officer that this edit leaves with no
    // points and no proof needs no sign-off any more (#4635, decision C):
    // signed off now, as Mark done would have, stamped with its own
    // completion time so it reads as automatic and can still be reopened.
    // Otherwise Confirm would refuse it and it would wait for good.
    if (
      !reassigned &&
      task.status === TaskStatus.COMPLETED &&
      ('point_reward' in patch || 'proof_kind' in patch) &&
      !taskNeedsSignOff({ ...task, ...patch })
    ) {
      patch.confirmed_at = task.completed_at ?? new Date().toISOString();
      patch.completed_at = patch.confirmed_at;
      patch.points_awarded = true;
    }

    if (Object.keys(patch).length === 0 && !photosChange) return task;

    // A photos-only edit still goes through the compare-and-set, as a write
    // of the one field it can't change, so a confirm that landed first wins.
    const updated = await this.taskRepo.updateUnconfirmed(
      id,
      chapterId,
      Object.keys(patch).length > 0 ? patch : { title: task.title },
    );
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

    // A completed task handed to someone else starts over at To do: its
    // "finished" rows in Activity are no longer so (#5732).
    if (reassigned && task.status === TaskStatus.COMPLETED) {
      await this.notificationService.retractTaskCompletion(chapterId, id);
    }

    // The removed reference photos, and on a hand-over the old proof.
    await this.dropPhotos(chapterId, id, [
      ...dropReference,
      ...(reassigned ? held.filter((photo) => photo.kind === 'proof') : []),
    ]);
    // New reference photos go in after the edit, as on create: a failed
    // insert (a path another write took first) is reported and the edit
    // stands; the officer sees the photos missing and adds them again.
    if (addReference.length > 0) {
      const from =
        Math.max(-1, ...heldReference.map((photo) => photo.position)) + 1;
      try {
        await this.taskRepo.createPhotos(
          this.photoRows(updated, 'reference', addReference, actorId, from),
        );
      } catch (error) {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'task-photos-edit',
          message: `reference photo insert failed for task ${id}`,
          error,
        });
      }
    }

    if (reassigned) await this.notifyAssigned(updated, actorId);
    return updated;
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
      task.assignee_id,
    ]);
    const nameOf = (id: string): string =>
      users.find((u) => u.id === id)?.display_name ?? 'Unknown member';
    const assignerName = nameOf(input.created_by);
    const assigneeName = nameOf(task.assignee_id);

    const payload = {
      task_id: task.id,
      title: task.title,
      assigner_user_id: input.created_by,
      assigner_name: assignerName,
      assignee_user_id: task.assignee_id,
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
    completion: CompletionInput = {},
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

    if (newStatus !== TaskStatus.COMPLETED) {
      const updated = await this.taskRepo.update(id, chapterId, {
        status: newStatus,
      });
      return this.viewWithPhotos(chapterId, updated);
    }
    return this.complete(task, chapterId, userId, completion);
  }

  /**
   * Mark done (#4565, #4635). Proof rides with it: the photos or link the
   * task's proof kind asks for, refused without them with a code a phone
   * build can match for as long as it stays installed, like service hours'
   * receipt rule. A task an officer sent back needs something new: fresh
   * proof, or a reply to the reason. A task with no points and no proof
   * needs no sign-off, so it is confirmed as it is marked done.
   */
  private async complete(
    task: Task,
    chapterId: string,
    userId: string,
    completion: CompletionInput,
  ): Promise<TaskView> {
    const proofPhotos = await this.checkedPhotoPaths(
      chapterId,
      completion.proof_photo_paths ?? [],
      'proof_photo_paths',
    );
    let proofLink: string | null = null;
    if (completion.proof_link?.trim()) {
      proofLink = normalizeProofLink(completion.proof_link);
      if (!proofLink) {
        throw new BadRequestException(
          'proof_link must be a web link starting with http:// or https://',
        );
      }
    }
    const note = completion.completion_note?.trim() || null;
    if (note && note.length > TASK_COMPLETION_NOTE_MAX) {
      throw new BadRequestException(
        `completion_note must be at most ${TASK_COMPLETION_NOTE_MAX} characters`,
      );
    }

    if (task.proof_kind === 'photo' && proofPhotos.length === 0) {
      throw new BadRequestException({
        code: TASK_PROOF_REQUIRED_CODE,
        message: TASK_PROOF_REQUIRED_MESSAGE,
      });
    }
    if (task.proof_kind === 'link' && !proofLink) {
      throw new BadRequestException({
        code: TASK_PROOF_REQUIRED_CODE,
        message: TASK_PROOF_LINK_REQUIRED_MESSAGE,
      });
    }
    // A send-back reopened the completion and cleared its proof, so any
    // proof sent now is new; with none, a reply to the reason is the change.
    if (task.sent_back_at && proofPhotos.length === 0 && !proofLink && !note) {
      throw new BadRequestException({
        code: TASK_RESUBMIT_NEEDS_CHANGE_CODE,
        message: TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE,
      });
    }

    // The rows go in first: `storage_path` is unique, so a path another
    // write took in the meantime fails here, before the task moves.
    const photos = await this.taskRepo.createPhotos(
      this.photoRows(task, 'proof', proofPhotos, userId),
    );

    const now = new Date().toISOString();
    const signedOff = !taskNeedsSignOff(task);
    let updated: Task | null;
    try {
      // Compare-and-set on what this completion was judged on: still in
      // progress, with the points and proof kind read above. An officer's
      // edit or a second Mark done landing in between matches nothing, so a
      // task is never signed off on points it has since gained, and proof
      // never piles up past the cap.
      updated = await this.taskRepo.updateIfMatches(
        task.id,
        chapterId,
        {
          status: task.status,
          point_reward: task.point_reward,
          proof_kind: task.proof_kind,
        },
        {
          status: TaskStatus.COMPLETED,
          completed_at: now,
          completed_by: userId,
          proof_link: proofLink,
          completion_note: note,
          // Decision C (#4635): nothing to award and nothing to check, so it
          // is Done now, stamped with the completion's own time
          // (`taskSignedOffAutomatically`). An officer can still send it
          // back.
          ...(signedOff ? { confirmed_at: now, points_awarded: true } : {}),
        },
      );
    } catch (error) {
      await this.dropPhotos(chapterId, task.id, photos);
      throw error;
    }
    if (!updated) {
      await this.dropPhotos(chapterId, task.id, photos);
      throw new BadRequestException(
        'This task changed while you were marking it done. Look again and retry.',
      );
    }

    await this.notifyTaskCompleted(updated, userId, chapterId, {
      photoCount: photos.length,
      resubmitted: !!task.sent_back_at,
    });
    return this.viewWithPhotos(chapterId, updated);
  }

  /**
   * Whether a completion can still be reopened: unconfirmed, or confirmed
   * only because it needed no sign-off (#4635), so no points were paid.
   */
  private isReopenable(task: Task): boolean {
    return !task.points_awarded || taskSignedOffAutomatically(task);
  }

  private async reopenOwnCompletion(
    task: Task,
    chapterId: string,
  ): Promise<TaskView> {
    if (!this.isReopenable(task)) {
      throw new BadRequestException(
        'An officer already confirmed this task, so it stays done',
      );
    }
    const proof = await this.proofPhotosOf(chapterId, task.id);
    const updated = await this.taskRepo.reopenCompletion(task.id, chapterId, {
      expectedCompletedAt: task.completed_at,
      pointsAwarded: task.points_awarded,
    });
    if (!updated) {
      // Null is any write that moved it first: an officer's confirm, their
      // reject, or this member's own take-back from another device.
      throw new BadRequestException(
        'This task is no longer waiting on confirmation',
      );
    }
    // The reopen cleared the link and reply; the photos it read go too, and
    // the next Mark done sends its own.
    await this.dropPhotos(chapterId, task.id, proof);
    // What Mark done told the officer and the followers isn't so any more:
    // Activity drops the "finished" rows (#5732).
    await this.notificationService.retractTaskCompletion(chapterId, task.id);
    return this.viewWithPhotos(chapterId, updated);
  }

  /** The proof photos a completion carries, as read now. */
  private async proofPhotosOf(
    chapterId: string,
    taskId: string,
  ): Promise<TaskPhoto[]> {
    return (await this.taskRepo.findPhotos(chapterId, [taskId])).filter(
      (photo) => photo.kind === 'proof',
    );
  }

  /**
   * A completed task needs a `tasks:manage` holder to confirm it before
   * points are awarded (spec/behavior/tasks.md), so the task's creator is
   * notified rather than every `tasks:manage` holder in the chapter — the
   * same "notify the creator, not a fan-out" rule the OVERDUE sweep already
   * uses (`scheduled-jobs.service.ts`'s `notifyTaskOverdue`), so completing
   * one task never turns into a broadcast to every officer. A followed task
   * (#5473) also tells its following tier, role or group, which its creator
   * chose and is in; that is the widest it goes.
   *
   * The creator's push no-ops when the creator is the one who just completed
   * it (self-assigned task, nothing to tell them) or has since left the
   * chapter.
   */
  private async notifyTaskCompleted(
    task: Task,
    actorUserId: string,
    chapterId: string,
    submitted: { photoCount: number; resubmitted: boolean },
  ): Promise<void> {
    await Promise.all([
      this.notifyCreatorCompleted(task, actorUserId, chapterId, submitted),
      this.notifyFollowersCompleted(task, actorUserId, chapterId, submitted),
    ]);
  }

  /**
   * The members of a task's following tier, role or group (#5473), read now,
   * leaving out its assignee and creator (each hears about it already) and
   * whoever acted. A failed read is reported and reaches nobody: the push
   * never fails the write it follows.
   */
  async followerRecipients(
    task: Pick<Task, 'id' | 'assignee_id' | 'created_by'> & {
      followed_by?: string | null;
    },
    chapterId: string,
    exclude: readonly string[] = [],
  ): Promise<string[]> {
    if (!task.followed_by) return [];
    try {
      const skip = new Set([task.assignee_id, task.created_by, ...exclude]);
      return (
        await this.audiences.followerIds(chapterId, task.followed_by)
      ).filter((id) => !skip.has(id));
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'task-followers-resolve',
        message: `could not read who follows task ${task.id}`,
        error,
      });
      return [];
    }
  }

  /**
   * A followed task was marked done (#5473): its following group hears, a
   * follower who can confirm it with the review push the creator gets, the
   * rest with one that only tells them.
   */
  private async notifyFollowersCompleted(
    task: Task,
    actorUserId: string,
    chapterId: string,
    submitted: { photoCount: number; resubmitted: boolean },
  ): Promise<void> {
    const recipients = await this.followerRecipients(task, chapterId, [
      actorUserId,
    ]);
    if (recipients.length === 0) return;
    const [name, confirmers, names] = await Promise.all([
      this.displayNameOf(task.assignee_id),
      // A failed read sends the informational push to everyone, and says so.
      this.audiences.canConfirm(chapterId, recipients).catch((error) => {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'task-followers-confirmers',
          message: `could not read who may confirm task ${task.id}`,
          error,
        });
        return new Set<string>();
      }),
      this.followerNames(chapterId, [task]).catch((error) => {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'task-followers-name',
          message: `could not read who task ${task.id} is from`,
          error,
        });
        return new Map<string, string>();
      }),
    ]);
    const who = name ?? 'A member';
    const followerName = names.get(task.followed_by ?? '') ?? null;
    for (let i = 0; i < recipients.length; i += GROUP_NOTIFY_CONCURRENCY) {
      await Promise.all(
        recipients.slice(i, i + GROUP_NOTIFY_CONCURRENCY).map((userId) =>
          this.safeNotifyUser(
            userId,
            chapterId,
            confirmers.has(userId)
              ? {
                  ...taskSubmittedCopy(who, task, submitted),
                  priority: 'NORMAL',
                  category: 'tasks',
                  threadId: TASK_REVIEW_PUSH_THREAD,
                  data: {
                    target: {
                      screen: 'tasks',
                      taskId: task.id,
                      view: 'review',
                    },
                  },
                }
              : {
                  ...taskFollowedFinishedCopy(who, task, followerName),
                  priority: 'NORMAL',
                  category: 'tasks',
                  // A group task's copies finish one by one: they stack in
                  // one pile on iOS, as the review pushes do.
                  threadId: `task-follow-${task.group_id ?? task.id}`,
                  // Marked, so a take-back can clear it (#5732).
                  data: {
                    about: 'task-completed',
                    target: { screen: 'tasks', taskId: task.id },
                  },
                },
            task.id,
            'completion-follower',
          ),
        ),
      );
    }
  }

  private async notifyCreatorCompleted(
    task: Task,
    actorUserId: string,
    chapterId: string,
    submitted: { photoCount: number; resubmitted: boolean },
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

    const name = (await this.displayNameOf(task.assignee_id)) ?? 'A member';
    await this.safeNotifyUser(
      task.created_by,
      chapterId,
      {
        ...taskSubmittedCopy(name, task, submitted),
        priority: 'NORMAL',
        category: 'tasks',
        // Every review stacks in one group on iOS, so a Sunday night of
        // chores is one pile on the lock screen, not twenty-five banners.
        threadId: TASK_REVIEW_PUSH_THREAD,
        // `view: 'review'` opens the review itself (Activity, with this
        // task's sheet up). A build that predates it reads only `screen`
        // and opens the task board, as it always has.
        data: {
          target: { screen: 'tasks', taskId: task.id, view: 'review' },
        },
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

    // No points and no proof: it was Done when marked (#4635), so there is
    // nothing to confirm.
    if (!taskNeedsSignOff(task)) {
      throw new BadRequestException(
        "This task doesn't need an officer to confirm it",
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

    const confirmer = (await this.displayNameOf(callerUserId)) ?? 'An officer';
    await this.safeNotifyUser(
      task.assignee_id,
      chapterId,
      {
        title: `${confirmer} confirmed: ${task.title}`,
        body: updated.point_reward ? `+${updated.point_reward} points` : 'Done',
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'confirmation',
    );

    return this.viewWithPhotos(chapterId, updated);
  }

  async rejectCompletion(
    id: string,
    chapterId: string,
    comment: string | null | undefined,
    options: { requirePhoto?: boolean; actorUserId?: string } = {},
  ): Promise<TaskView> {
    // A send-back says why (#4635): the reason stays on the task for the
    // assignee, and the push carries it.
    const reason = comment?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException('Say what needs to change to send it back');
    }
    if (reason.length > TASK_SEND_BACK_REASON_MAX) {
      throw new BadRequestException(
        `The reason must be at most ${TASK_SEND_BACK_REASON_MAX} characters`,
      );
    }
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.status !== TaskStatus.COMPLETED) {
      throw new BadRequestException('Only completed tasks can be rejected');
    }

    if (!this.isReopenable(task)) {
      throw new BadRequestException(
        'Cannot reject a task that has already been confirmed and points awarded',
      );
    }

    // Compare-and-set, so a confirm (or the assignee taking it back) that
    // lands between the guards above and this write is not overwritten. The
    // send-back time is when it waits on the assignee again: Activity serves
    // it unread to them from then (`spec/behavior/activity.md` § Unread).
    const proof = await this.proofPhotosOf(chapterId, id);
    const updated = await this.taskRepo.reopenCompletion(id, chapterId, {
      sentBackAt: new Date().toISOString(),
      sentBackReason: reason,
      // "Ask for a photo next time" raises a None or Link task to Photo.
      ...(options.requirePhoto ? { proofKind: 'photo' as const } : {}),
      expectedCompletedAt: task.completed_at,
      pointsAwarded: task.points_awarded,
    });
    if (!updated) {
      throw new BadRequestException(
        'Task is no longer waiting on confirmation — it was confirmed or moved back already',
      );
    }
    await this.dropPhotos(chapterId, id, proof);
    // Open again: the "finished" rows in Activity are no longer so (#5732).
    await this.notificationService.retractTaskCompletion(chapterId, id);

    const sender =
      (options.actorUserId &&
        (await this.displayNameOf(options.actorUserId))) ||
      'An officer';
    await this.safeNotifyUser(
      task.assignee_id,
      chapterId,
      {
        title: `${sender} sent back: ${task.title}`,
        body: `"${reason}"`,
        priority: 'NORMAL',
        category: 'tasks',
        data: { target: { screen: 'tasks', taskId: task.id } },
      },
      task.id,
      'rejection',
    );

    return this.viewWithPhotos(chapterId, updated);
  }

  private safeNotifyUser(
    assigneeId: string,
    chapterId: string,
    payload: NotifyPayload,
    taskId: string,
    notificationContext = 'update',
  ): Promise<void> {
    return notifyQuietly(this.notificationService, this.logger, {
      userId: assigneeId,
      chapterId,
      payload,
      site: 'task-notify',
      about: `task ${taskId} (${notificationContext})`,
    });
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const task = await this.taskRepo.findById(id, chapterId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const photos = await this.taskRepo.findPhotos(chapterId, [id]);
    // The rows go with the task (on delete cascade); the objects after.
    await this.taskRepo.delete(id, chapterId);
    await this.releasePhotos(
      chapterId,
      photos.map((photo) => photo.storage_path),
    );
  }
}
