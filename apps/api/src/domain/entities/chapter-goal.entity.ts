import { GOAL_METRICS, type GoalMetric } from '@repo/validation';

/**
 * What a chapter holds its members to (#1062), persisted to `chapter_goals`
 * (`20261113040003_chapter_goals.sql`), one row per chapter and measure.
 *
 * - `points`: points this semester, in points.
 * - `service`: approved service hours this semester, in minutes.
 * - `study`: study hours this week (the Study screen's Sunday week), in
 *   minutes.
 */
// One list of measures, shared with the settings form and the hooks; the
// migration's `metric` check is its third copy.
export { GOAL_METRICS, type GoalMetric };

/**
 * A different goal for the members who hold one role, or `null` to hold them
 * to no goal at all (alumni, say, while everyone else owes six hours).
 */
export interface RoleGoal {
  role_id: string;
  target: number | null;
}

/** One measure's goals: everyone's, and any role set apart. */
export interface GoalSet {
  /** Every member's goal, or `null` for none. */
  everyone: number | null;
  /** Roles held to a different goal; a role appears at most once. */
  roles: RoleGoal[];
}

export interface ChapterGoalRow {
  chapter_id: string;
  metric: GoalMetric;
  goals: GoalSet;
  updated_at: string;
  updated_by: string | null;
}
