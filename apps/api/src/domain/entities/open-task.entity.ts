import type { OpenTaskScope, TaskProofKind } from '@repo/validation';

/** Whether a task up for grabs is still waiting, or someone has it. */
export type OpenTaskStatus = 'open' | 'claimed';

/**
 * A task up for grabs (Paul, 2026-11-18; `spec/behavior/tasks.md` § Up for
 * grabs): one task posted for someone in the chapter, a role, a chapter group
 * or a list of people. An eligible member claims it, or an officer hands it to
 * someone; either way one ordinary task is written for them
 * (`claim_open_task`), and the posting is marked claimed. Its assignee can
 * give it back before they've finished it, which opens it again.
 */
export interface OpenTask {
  id: string;
  chapter_id: string;
  created_by: string;
  title: string;
  description: string | null;
  due_date: string;
  /** The moment it is due, when it has a time of day. */
  due_at: string | null;
  point_reward: number | null;
  proof_kind: TaskProofKind;
  /** The checklist the claimed task starts with, in order. */
  subtask_titles: string[];
  /** Who may claim it. */
  scope: OpenTaskScope;
  /** The role or group it names, for `role` and `group`. */
  scope_id: string | null;
  /** That role's or group's name when posted, shown once it's deleted. */
  scope_name: string | null;
  /** The people who may claim it, for `people`. */
  scope_user_ids: string[] | null;
  status: OpenTaskStatus;
  /** The task claiming it made; null while open, or once that task is deleted. */
  claimed_task_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A task up for grabs as its reads return it: who may claim it, counted now,
 * and whether the reader may.
 */
export interface OpenTaskView extends OpenTask {
  /** How many members may claim it now (alumni left out). */
  eligible_count: number;
  /** Whether the reader may claim it now. */
  viewer_can_claim: boolean;
}
