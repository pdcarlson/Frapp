import type { OpenTask } from '../entities/open-task.entity';
import type { Task } from '../entities/task.entity';

export const OPEN_TASK_REPOSITORY = 'OPEN_TASK_REPOSITORY';

/** What a claim answers (`claim_open_task`). */
export type OpenTaskClaimResult =
  | { ok: true; task: Task }
  /** `missing`: the chapter has no such posting; `taken`: it isn't open. */
  | { ok: false; reason: 'missing' | 'taken' };

/** What giving a claimed task back answers (`release_open_task`). */
export type OpenTaskReleaseResult =
  | { ok: true; posting: OpenTask }
  /**
   * `missing`: the task wasn't claimed from a posting of the chapter;
   * `not_assignee`: it isn't the caller's; `done`: it's marked done, paid or
   * carries proof, so it can't go back.
   */
  | { ok: false; reason: 'missing' | 'not_assignee' | 'done' };

/** The fields an officer may change on a posting while it is open. */
export type OpenTaskChanges = Partial<
  Pick<
    OpenTask,
    | 'title'
    | 'description'
    | 'due_date'
    | 'due_at'
    | 'point_reward'
    | 'proof_kind'
    | 'subtask_titles'
  >
>;

/** Tasks up for grabs (2026-11-18; `spec/behavior/tasks.md` § Up for grabs). */
export interface IOpenTaskRepository {
  findById(chapterId: string, id: string): Promise<OpenTask | null>;
  /** The chapter's open postings, oldest due first. */
  findOpen(chapterId: string): Promise<OpenTask[]>;
  /**
   * Which posting each of these tasks was claimed from, by task id. Tasks
   * claimed from none are absent.
   */
  findClaimedFrom(
    chapterId: string,
    taskIds: string[],
  ): Promise<Map<string, string>>;
  create(
    data: Omit<
      OpenTask,
      | 'id'
      | 'status'
      | 'claimed_task_id'
      | 'claimed_by'
      | 'claimed_at'
      | 'created_at'
      | 'updated_at'
    >,
  ): Promise<OpenTask>;
  /**
   * Write `changes` while the posting is still open (compare-and-set on
   * `status`). Null when the chapter has no such open posting.
   */
  updateOpen(
    chapterId: string,
    id: string,
    changes: OpenTaskChanges,
  ): Promise<OpenTask | null>;
  /** Delete the posting while it is still open. False when none was. */
  deleteOpen(chapterId: string, id: string): Promise<boolean>;
  /**
   * One task for `assigneeId` from the posting, and the posting marked
   * claimed, under its row lock: of two claims at once, one gets `taken`.
   * `createdBy` is the task's creator (the posting's, who reviews it).
   */
  claim(
    chapterId: string,
    id: string,
    assigneeId: string,
    createdBy: string,
  ): Promise<OpenTaskClaimResult>;
  /** Give back a task claimed from a posting: it goes, the posting opens. */
  release(
    chapterId: string,
    taskId: string,
    userId: string,
  ): Promise<OpenTaskReleaseResult>;
}
