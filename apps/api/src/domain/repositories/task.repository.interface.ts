import {
  Task,
  TaskPhoto,
  TaskGroup,
  TaskGroupCopyState,
  TaskSeries,
  TaskStatus,
  TaskSubtask,
} from '../entities/task.entity';
import type { TaskGroupAudience, TaskProofKind } from '@repo/validation';

export const TASK_REPOSITORY = 'TASK_REPOSITORY';

/**
 * Where a page of tasks resumes: the `created_at` and `id` of the last row of
 * the page before. Both, because `created_at` alone ties (every row inserted
 * in one transaction shares `now()`), and a tie at a page boundary would
 * repeat or drop rows.
 */
export interface TaskListCursor {
  created_at: string;
  id: string;
}

/**
 * Which of a chapter's tasks to read or count (#4037). Every filter is
 * applied in SQL, on the stored status (never the display `OVERDUE`).
 */
export interface TaskListFilter {
  /** Only this assignee's tasks. */
  assigneeId?: string;
  /**
   * With `assigneeId`: also the tasks any of these follower entries follows
   * (#5473), so a member's board holds what their groups follow.
   */
  orFollowedBy?: readonly string[];
  /** Leave out this assignee's tasks. */
  notAssigneeId?: string;
  /** Only tasks this member created. */
  createdBy?: string;
  /**
   * `true`: only one-person tasks, leaving out every copy of a task for
   * everyone (`group_id` is null), so a list of what someone assigned can
   * count each group once beside them (#5492).
   */
  groupless?: boolean;
  /** Only tasks in this stored status. */
  status?: TaskStatus;
  /** `true`: only confirmed tasks; `false`: only unconfirmed ones. */
  confirmed?: boolean;
  /** Only tasks marked done at or after this instant (`completed_at`). */
  completedSince?: string;
  /**
   * Only tasks not yet confirmed, or marked done at or after this instant
   * (`completed_at`), confirmed or not: one read that holds a member's open
   * tasks and what they finished since, for Activity (#5746). Not with `after`.
   */
  unconfirmedOrCompletedSince?: string;
}

/**
 * A read of a chapter's tasks. Both orders are total, so a page never repeats
 * or skips a row.
 */
export interface TaskListQuery extends TaskListFilter {
  /**
   * `newest` (the default): `created_at` then `id`, newest first.
   * `longest_waiting`: `completed_at`, then `created_at` and `id`, oldest
   * first, for a list of completions waiting on a confirm.
   */
  order?: 'newest' | 'longest_waiting';
  /** Resume after this row. Only with the `newest` order. */
  after?: TaskListCursor;
  /**
   * At most this many rows. Omitted: every matching row, read in pages so the
   * database's row cap never cuts the list short.
   */
  limit?: number;
}

export interface ITaskRepository {
  findById(id: string, chapterId: string): Promise<Task | null>;
  /** The chapter's tasks among `ids`, in no particular order; missing ids are left out. */
  findByIds(chapterId: string, ids: string[]): Promise<Task[]>;
  /** The chapter's tasks that match `query`, in its order (newest first by default). */
  findByChapter(chapterId: string, query?: TaskListQuery): Promise<Task[]>;
  /** How many of the chapter's tasks match `query`, counted in SQL. */
  countByChapter(chapterId: string, query?: TaskListFilter): Promise<number>;
  /**
   * {@link findByChapter}, and with `withTotal` how many rows match before
   * `limit` (#5746), counted by the request that reads the first page, so a
   * capped list and its total cost one round trip. An uncapped read is
   * counted too, which ends it without an empty page. `total` is null when
   * the read was not counted.
   */
  findByChapterCounted(
    chapterId: string,
    query?: TaskListQuery,
    options?: { withTotal?: boolean },
  ): Promise<{ tasks: Task[]; total: number | null }>;
  /**
   * The chapter's tasks due on or after `dueFrom` (`YYYY-MM-DD`), or made at
   * or after `createdFrom`, every row of them: read in pages, so a chapter
   * with more rows than one response holds loses none.
   */
  findSince(
    chapterId: string,
    since: { dueFrom: string; createdFrom: string },
  ): Promise<Task[]>;
  create(data: Partial<Task>): Promise<Task>;
  update(id: string, chapterId: string, data: Partial<Task>): Promise<Task>;
  /**
   * Set who follows every copy of a group task (#5473), confirmed ones too,
   * so a group reads as one task to its followers.
   */
  setGroupFollower(
    chapterId: string,
    groupId: string,
    followedBy: string | null,
  ): Promise<void>;
  /**
   * Write `data` only while the row still holds every value in `match`
   * (compare-and-set; a `null` in `match` means the column is null). Returns
   * the updated task, or `null` when another write changed one of them
   * first. Mark done uses it so a completion is judged on the task as it
   * stands (#4635).
   */
  updateIfMatches(
    id: string,
    chapterId: string,
    match: Partial<Task>,
    data: Partial<Task>,
  ): Promise<Task | null>;
  /**
   * Atomically confirm a COMPLETED task and award its point reward in a single
   * database transaction (compare-and-set on `points_awarded`). Returns the
   * updated task, or `null` when nothing was updated — task missing, not
   * COMPLETED, or already awarded (e.g. a concurrent confirm won the race).
   */
  confirmCompletionAtomic(id: string, chapterId: string): Promise<Task | null>;
  /**
   * Move a COMPLETED task back to IN_PROGRESS and clear `completed_at`,
   * `proof_link` and `completion_note`, only while it is still COMPLETED and
   * unconfirmed (compare-and-set on `status` and `points_awarded`). Returns
   * the updated task, or `null` when nothing was updated: an officer
   * confirmed it, or another write moved it first. A task that needed no
   * sign-off reopens from its automatic confirm (`options.pointsAwarded`). Backs both an officer's
   * send-back and the assignee taking back their own "done" before it is
   * confirmed. The caller deletes the proof photo rows it read.
   */
  reopenCompletion(
    id: string,
    chapterId: string,
    options?: ReopenCompletionOptions,
  ): Promise<Task | null>;
  /**
   * An officer's edit (#4296), only while the task is unconfirmed
   * (compare-and-set on `points_awarded`). Returns the updated task, or `null`
   * when nothing was updated: the task is gone, or a confirm landed first.
   */
  updateUnconfirmed(
    id: string,
    chapterId: string,
    data: Partial<Task>,
  ): Promise<Task | null>;
  /**
   * Forget which due-soon and overdue reminders this task has had, so the
   * sweeps remind about its new due date, time or assignee (#4296). The
   * claims are keyed on `due_date`, so a timed task moved within its day
   * would otherwise never be reminded again.
   */
  releaseReminderClaims(chapterId: string, taskId: string): Promise<void>;
  delete(id: string, chapterId: string): Promise<void>;
  /**
   * A repeating task's series and its first copy, with the copy's checklist,
   * in one transaction (#5119): a failure leaves neither. Returns the copy.
   */
  createSeries(input: CreateTaskSeriesInput): Promise<Task>;
  /**
   * A task for everyone (#4295 step 3): its group, a copy per member and each
   * copy's checklist, in one transaction. Returns the copies.
   */
  createGroup(input: CreateTaskGroupInput): Promise<Task[]>;
  /** These groups of the chapter, any order. */
  findGroups(chapterId: string, ids: string[]): Promise<TaskGroup[]>;
  /** Every copy of these groups, any order. */
  findGroupCopies(chapterId: string, groupIds: string[]): Promise<Task[]>;
  /**
   * Every copy of these groups as {@link TaskGroupCopyState}, a few columns
   * each, by id: for counting a group and drawing its row (#5492).
   */
  findGroupCopyStates(
    chapterId: string,
    groupIds: string[],
  ): Promise<TaskGroupCopyState[]>;
  /**
   * The groups this member made that still have a copy not confirmed, newest
   * first, at most `limit` (#5492). A group whose every copy is confirmed is
   * finished, and left out in SQL so it never takes a slot from a live one.
   */
  findUnfinishedGroupsByCreator(
    chapterId: string,
    createdBy: string,
    limit: number,
  ): Promise<TaskGroup[]>;
  /**
   * Delete a group's copies and then its row (#4295 step 3). Photo and
   * subtask rows go with their copies (on delete cascade).
   */
  deleteGroup(chapterId: string, groupId: string): Promise<void>;
  /**
   * Delete these copies of a group (#5492), the group's row staying. Only
   * copies not yet confirmed go: one confirmed since it was read stays, its
   * points paid on it. Returns the ids deleted.
   */
  deleteGroupCopies(
    chapterId: string,
    groupId: string,
    ids: string[],
  ): Promise<string[]>;
  /** These series of the chapter, any order. */
  findSeries(chapterId: string, ids: string[]): Promise<TaskSeries[]>;
  /** A series' latest copy (the furthest `occurrence_date`), or null. */
  findLatestSeriesCopy(
    chapterId: string,
    seriesId: string,
  ): Promise<Task | null>;
  /**
   * Write `data` to a live series only while its `next_due_date` is still
   * `expectedNext` (compare-and-set against the sweep making a copy between
   * the caller's read and this write). Null when it no longer matches.
   */
  updateSeriesIfNext(
    chapterId: string,
    id: string,
    expectedNext: string,
    data: Partial<TaskSeries>,
  ): Promise<TaskSeries | null>;
  /**
   * Whether any of a task's subtasks is checked: a copy with one is not
   * "untouched", so ending its series keeps it (#5119).
   */
  hasCheckedSubtask(chapterId: string, taskId: string): Promise<boolean>;
  /**
   * Whether any photo row holds this storage path (#4565, #4635): one object
   * belongs to one photo, so releasing it can never delete a photo another
   * task still shows. `task_photos.storage_path` is unique, so a racing
   * second insert fails too.
   */
  isPhotoPathInUse(chapterId: string, path: string): Promise<boolean>;
  /** Photos of these tasks, ordered by task, kind, then position (#4635). */
  findPhotos(chapterId: string, taskIds: string[]): Promise<TaskPhoto[]>;
  /** Adds photo rows. Fails whole when any path is already held. */
  createPhotos(
    rows: Pick<
      TaskPhoto,
      | 'task_id'
      | 'chapter_id'
      | 'kind'
      | 'storage_path'
      | 'position'
      | 'created_by'
    >[],
  ): Promise<TaskPhoto[]>;
  /** Removes these photo rows of one task; returns the ones removed. */
  deletePhotos(
    chapterId: string,
    taskId: string,
    photoIds: string[],
  ): Promise<TaskPhoto[]>;
  /** Subtasks of these tasks, ordered by task then position (#4003). */
  findSubtasks(chapterId: string, taskIds: string[]): Promise<TaskSubtask[]>;
  /** Adds subtasks at the given positions. */
  createSubtasks(
    rows: Pick<TaskSubtask, 'task_id' | 'chapter_id' | 'title' | 'position'>[],
  ): Promise<TaskSubtask[]>;
  /** Ticks or unticks one. `null` when it isn't under that task. */
  setSubtaskDone(
    chapterId: string,
    taskId: string,
    subtaskId: string,
    doneAt: string | null,
  ): Promise<TaskSubtask | null>;
  /** Removes one. `false` when it isn't under that task. */
  deleteSubtask(
    chapterId: string,
    taskId: string,
    subtaskId: string,
  ): Promise<boolean>;
}

/** What a reopen writes besides the status (#4635). */
export interface ReopenCompletionOptions {
  /**
   * Set only for an officer's send-back: when the task started waiting on the
   * assignee again.
   */
  sentBackAt?: string;
  /** The send-back's reason, stored with `sentBackAt`. */
  sentBackReason?: string;
  /** "Ask for a photo next time": the send-back raises the proof kind. */
  proofKind?: TaskProofKind;
  /**
   * The `completed_at` the caller read: the write matches only that
   * completion, so a reopen meant for an older one never clears a newer
   * completion's proof (#4565's guard, keyed on the completion now).
   */
  expectedCompletedAt?: string | null;
  /**
   * The `points_awarded` the caller read, matched by the compare-and-set.
   * `true` only for a task that needed no sign-off (#4635): confirmed as it
   * was marked done with nothing paid, so it can still be reopened, which
   * clears `confirmed_at` and `points_awarded`. Default `false`.
   */
  pointsAwarded?: boolean;
}

/** What {@link ITaskRepository.createSeries} writes (#5119). */
export interface CreateTaskSeriesInput {
  chapter_id: string;
  created_by: string;
  title: string;
  description: string | null;
  assignee_id: string;
  point_reward: number | null;
  proof_kind: TaskProofKind;
  subtask_titles: string[];
  due_time: string | null;
  recurrence_rule: string;
  /** The first copy's day, which the rule counts from. */
  first_due_date: string;
  /** The first copy's due moment, when it has a time of day. */
  first_due_at: string | null;
  /** When the first copy is due in the rule's zone (end of day if untimed). */
  latest_due_at: string;
  next_due_date: string;
}

/** What {@link ITaskRepository.createGroup} writes (#4295 step 3). */
export interface CreateTaskGroupInput {
  chapter_id: string;
  created_by: string;
  audience: TaskGroupAudience;
  /** The role or chapter group it goes to; null for everyone and people. */
  target_id: string | null;
  /** That role's or group's name now, kept for once it's deleted. */
  target_name: string | null;
  /** Who gets a copy: one per distinct user id. */
  assignee_ids: string[];
  title: string;
  description: string | null;
  due_date: string;
  due_at: string | null;
  point_reward: number | null;
  proof_kind: TaskProofKind;
  subtask_titles: string[];
  /** The minutes the task was suggested from (#5562), on every copy. */
  meeting_id?: string | null;
  /** The tier, role or group every copy is from (#5473), or null. */
  followed_by?: string | null;
}
