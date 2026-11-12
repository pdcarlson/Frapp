/**
 * What a chapter holds its members to (#1062), persisted to `chapter_goals`
 * (`20261112291500_chapter_goals.sql`), one row per chapter and measure.
 *
 * - `points`: points this semester, in points.
 * - `service`: approved service hours this semester, in minutes.
 * - `study`: study hours this week (the Study screen's Sunday week), in
 *   minutes.
 */
export const GOAL_METRICS = ['points', 'service', 'study'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** A different goal for the members who hold one role. */
export interface RoleGoal {
  role_id: string;
  target: number;
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
