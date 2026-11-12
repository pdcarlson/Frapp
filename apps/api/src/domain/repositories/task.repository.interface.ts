import { Task, TaskStatus, TaskSubtask } from '../entities/task.entity';

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
   * Atomically confirm a COMPLETED task and award its point reward in a single
   * database transaction (compare-and-set on `points_awarded`). Returns the
   * updated task, or `null` when nothing was updated — task missing, not
   * COMPLETED, or already awarded (e.g. a concurrent confirm won the race).
   */
  confirmCompletionAtomic(id: string, chapterId: string): Promise<Task | null>;
  /**
   * Move a COMPLETED task back to IN_PROGRESS and clear `completed_at` and
   * `proof_photo_path`, only
   * while it is still COMPLETED and unconfirmed (compare-and-set on `status`
   * and `points_awarded`). Returns the updated task, or `null` when nothing
   * was updated: an officer confirmed it, or another write moved it first.
   * Backs both an officer's reject and the assignee taking back their own
   * "done" before it is confirmed. `sentBackAt` is set only for the reject:
   * it is when the task started waiting on the assignee again.
   */
  reopenCompletion(
    id: string,
    chapterId: string,
    sentBackAt?: string,
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
   * Whether any of the chapter's tasks holds this storage path as either of
   * its photos (#4565): one object belongs to one task, so releasing it can
   * never delete a photo another task still shows.
   */
  isPhotoPathInUse(chapterId: string, path: string): Promise<boolean>;
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
