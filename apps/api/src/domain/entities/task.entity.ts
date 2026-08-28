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
  status: TaskStatus;
  point_reward: number | null;
  points_awarded: boolean;
  completed_at: string | null;
  confirmed_at: string | null;
  created_at: string;
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
}
