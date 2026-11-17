import type {
  TaskAudience,
  TaskGroupProgress,
  TaskProofKind,
} from '@repo/validation';

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
}

export interface Task {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  /**
   * The moment the task is due, when it has a time of day (#4003). Null for a
   * task due on `due_date` with no time. When set, `due_date` is still the
   * calendar day the creator saw, and overdue starts at this instant.
   */
  due_at: string | null;
  status: TaskStatus;
  point_reward: number | null;
  points_awarded: boolean;
  completed_at: string | null;
  confirmed_at: string | null;
  /**
   * When an officer last sent the completion back to the assignee; `null`
   * if never. The assignee taking back their own completion doesn't set it.
   */
  sent_back_at: string | null;
  /**
   * What Mark done needs (#4635): nothing, one or more proof photos, or a
   * link. `none` by default. Replaced #4565's `photo_required`.
   */
  proof_kind: TaskProofKind;
  /**
   * The assignee's link proof, sent with Mark done (http/https, stored as
   * typed, never fetched). Cleared with the completion, like proof photos.
   */
  proof_link: string | null;
  /**
   * Why an officer last sent the completion back (#4635). Kept through the
   * next Mark done so the officer sees what they asked beside the reply, and
   * cleared when the task is handed to someone else.
   */
  sent_back_reason: string | null;
  /** The assignee's reply sent with Mark done, cleared with the completion. */
  completion_note: string | null;
  /**
   * The repeating series this task is a copy of (#5119), or null for a task
   * that doesn't repeat. Kept when the series ends; cleared only if its row
   * is deleted.
   */
  series_id: string | null;
  /** A copy's day in its series' pattern (`YYYY-MM-DD`); null otherwise. */
  occurrence_date: string | null;
  /**
   * The group task this is one member's copy of (#4295 step 3), or null for a
   * task given to one person. Each copy is an ordinary task with its own
   * progress, proof and points.
   */
  group_id: string | null;
  created_at: string;
}

/**
 * A task given to a group (#4295 step 3): one row naming who it went to, and
 * one ordinary `tasks` row per member (a copy), made together.
 */
export interface TaskGroup {
  id: string;
  chapter_id: string;
  created_by: string;
  audience: TaskAudience;
  created_at: string;
}

/** What a task read says about its group (#4295 step 3). */
export interface TaskGroupSummary extends TaskGroupProgress {
  id: string;
  audience: TaskAudience;
}

/**
 * A repeating task's series (#5119): the template each copy is made from and
 * the rule it repeats on. Only the next upcoming copy exists; the 5-minute
 * sweep makes the following one once the latest copy is due.
 */
export interface TaskSeries {
  id: string;
  chapter_id: string;
  created_by: string;
  title: string;
  description: string | null;
  assignee_id: string;
  point_reward: number | null;
  proof_kind: TaskProofKind;
  /** The checklist each copy starts with, in order. */
  subtask_titles: string[];
  /** Copies' time of day on the rule's wall clock (`HH:MM:SS`), or null. */
  due_time: string | null;
  /** The rule, in the event rule format with an open end allowed. */
  recurrence_rule: string;
  /** The day the rule counts from: its first copy, or where it last changed. */
  first_due_date: string;
  /** The day of the next copy still to be made. */
  next_due_date: string;
  /** When the latest copy is due: the sweep makes the next one after it. */
  latest_due_at: string;
  made_count: number;
  /** When the series stopped making copies; null while it is live. */
  ended_at: string | null;
  created_at: string;
}

/** What a task read says about its series (#5119). */
export interface TaskSeriesSummary {
  recurrence_rule: string;
  /** The next copy's day; meaningless once `ended`. */
  next_due_date: string;
  ended: boolean;
}

/**
 * A task as the read paths return it.
 *
 * `status` is the **display** status: `toDisplayStatus` rewrites it to
 * `OVERDUE` for a `TODO` or `IN_PROGRESS` task past its due date. `OVERDUE` is
 * never persisted, so that rewrite is lossy — `TODO`+past-due and
 * `IN_PROGRESS`+past-due render identically, with `completed_at: null` on both.
 *
 * `stored_status` carries the value actually persisted, which is what
 * `VALID_ASSIGNEE_TRANSITIONS` is checked against. Without it no client can
 * compute an overdue task's next legal transition, so no client can offer an
 * action on one — which is why an overdue task could not be advanced from any
 * surface (#1051).
 *
 * Additive by design: `status` keeps its existing derived value, so a consumer
 * grouping by it (the web board's OVERDUE column) is untouched.
 */
export interface TaskView extends Task {
  stored_status: TaskStatus;
  /**
   * The task's subtasks, in order (#4003). Present on the list and detail
   * reads; a status write returns the task without them, and a client keeps
   * the ones it holds.
   */
  subtasks?: TaskSubtask[];
  /**
   * The task's photos (#4635): reference photos, then proof photos, each in
   * order. Present on the list and detail reads and on status writes.
   */
  photos?: TaskPhoto[];
  /**
   * How the task repeats, on a copy of a series (#5119); null on a task that
   * doesn't repeat. Present on the list and detail reads.
   */
  series?: TaskSeriesSummary | null;
  /**
   * The group task this is a copy of, with how far the group is (#4295 step
   * 3); null on a task given to one person. Present on the list and detail
   * reads.
   */
  group?: TaskGroupSummary | null;
}

/** Which of a task's photos: the officer's reference or the assignee's proof. */
export type TaskPhotoKind = 'reference' | 'proof';

/**
 * One task photo (#4635), a storage key in the private `tasks` bucket under
 * `chapters/{chapter_id}/tasks/`. Up to 6 per task and kind. A proof photo
 * goes with its completion: taking it back, sending it back or handing the
 * task over deletes it. Read through `GET /v1/tasks/:id/photos/:photoId/url`.
 */
export interface TaskPhoto {
  id: string;
  task_id: string;
  chapter_id: string;
  kind: TaskPhotoKind;
  storage_path: string;
  /** Order within its kind, 0 first. */
  position: number;
  created_by: string | null;
  created_at: string;
}

/**
 * One line of a task's checklist (#4003): a step the assignee ticks off.
 * It has no assignee, due date or points of its own; the task's carry it.
 */
export interface TaskSubtask {
  id: string;
  task_id: string;
  chapter_id: string;
  title: string;
  /** Order under the task, 0 first. */
  position: number;
  /** When it was ticked; null while it is still to do. */
  done_at: string | null;
  created_at: string;
}
