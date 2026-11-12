import { Task, TaskSubtask } from '../entities/task.entity';

export const TASK_REPOSITORY = 'TASK_REPOSITORY';

export interface ITaskRepository {
  findById(id: string, chapterId: string): Promise<Task | null>;
  findByChapter(chapterId: string): Promise<Task[]>;
  /**
   * The chapter's tasks due on or after `dueFrom` (`YYYY-MM-DD`), or made at
   * or after `createdFrom`, every row of them: read in pages, so a chapter
   * with more rows than one response holds loses none.
   */
  findSince(
    chapterId: string,
    since: { dueFrom: string; createdFrom: string },
  ): Promise<Task[]>;
  findByAssignee(chapterId: string, assigneeId: string): Promise<Task[]>;
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
   * Move a COMPLETED task back to IN_PROGRESS and clear `completed_at`, only
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
