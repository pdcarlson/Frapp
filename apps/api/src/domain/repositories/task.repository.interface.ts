import { Task, TaskSubtask } from '../entities/task.entity';

export const TASK_REPOSITORY = 'TASK_REPOSITORY';

export interface ITaskRepository {
  findById(id: string, chapterId: string): Promise<Task | null>;
  findByChapter(chapterId: string): Promise<Task[]>;
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
   * "done" before it is confirmed.
   */
  reopenCompletion(id: string, chapterId: string): Promise<Task | null>;
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
