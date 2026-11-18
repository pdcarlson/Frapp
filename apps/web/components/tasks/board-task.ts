import type { LiveTaskPhoto, TaskStatus, TaskSubtask } from "@repo/hooks";
import type { TaskProofKind, TaskSeriesLine } from "@repo/validation";

/** A task as the Tasks page reads it from `GET /v1/tasks`. */
export type BoardTask = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  /** The moment it is due, when it has a time of day (#4003). */
  due_at?: string | null;
  /** Its checklist, in order (#4003). */
  subtasks?: TaskSubtask[];
  /** Task photos, reference then proof (#4635). */
  photos?: LiveTaskPhoto[];
  /** What Mark done needs (#4635). */
  proof_kind?: TaskProofKind;
  proof_link?: string | null;
  /** When an officer last sent it back, and why (#4635). */
  sent_back_at?: string | null;
  sent_back_reason?: string | null;
  completion_note?: string | null;
  /** Display status — `OVERDUE` when derived. Drives the grouping. */
  status: TaskStatus;
  /**
   * The persisted status (#1051). Drives which action is offered: `OVERDUE`
   * renders identically for a stored `TODO` and a stored `IN_PROGRESS`, and the
   * server checks its transition table against this one. Optional because the
   * pre-#1051 API did not send it; falling back to `status` reproduces the old
   * behaviour, where an overdue task simply offered no action.
   */
  stored_status?: TaskStatus;
  point_reward: number | null;
  points_awarded: boolean;
  completed_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  /** How it repeats, on a copy of a repeating task (#5119). */
  series?: TaskSeriesLine | null;
  /** The group task this is one member's copy of (#4295 step 3). */
  group_id?: string | null;
  /** The group's who and progress over all its copies, as the API counts it. */
  group?: {
    audience?: string;
    target_id?: string | null;
    target_name?: string | null;
    total: number;
    done: number;
    confirmed?: number;
  } | null;
  /** The Up for grabs posting it was claimed from (2026-11-18), if any. */
  open_task_id?: string | null;
};

/**
 * A group task on the chapter's board (#4295 step 3): its copies still to
 * finish drawn as one row, "0 of 6", the way Google Classroom shows one
 * assignment with its turned-in count rather than a row per student. A copy
 * marked done leaves it for Waiting on an officer, where it is confirmed like
 * any task.
 */
export type GroupTileData = {
  id: string;
  /** One open copy, read for what every copy shares. */
  sample: BoardTask;
  /** The copies still to finish, soonest due first. */
  open: BoardTask[];
  total: number;
  done: number;
};
