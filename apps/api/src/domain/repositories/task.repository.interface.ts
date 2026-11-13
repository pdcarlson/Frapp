import {
  Task,
  TaskPhoto,
  TaskStatus,
  TaskSubtask,
} from '../entities/task.entity';
import type { TaskProofKind } from '@repo/validation';

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
  /** Leave out this assignee's tasks. */
  notAssigneeId?: string;
  /** Only tasks this member created. */
  createdBy?: string;
  /** Only tasks in this stored status. */
  status?: TaskStatus;
  /** `true`: only confirmed tasks; `false`: only unconfirmed ones. */
  confirmed?: boolean;
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
  /** The chapter's tasks that match `query`, in its order (newest first by default). */
  findByChapter(chapterId: string, query?: TaskListQuery): Promise<Task[]>;
  /** How many of the chapter's tasks match `query`, counted in SQL. */
  countByChapter(chapterId: string, query?: TaskListFilter): Promise<number>;
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
