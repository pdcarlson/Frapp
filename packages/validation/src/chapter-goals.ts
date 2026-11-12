/**
 * Chapter goals (#1062): the limits both the API and the settings form hold a
 * goal to. Points are whole points; service and study goals are stored in
 * minutes and entered in whole hours.
 */
export const GOAL_METRICS = ["points", "service", "study"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** The largest goal each measure accepts, in its stored unit. */
export const GOAL_TARGET_MAX: Readonly<Record<GoalMetric, number>> = {
  // Matches the ±100,000 ceiling on a single points adjustment.
  points: 100_000,
  // 500 service hours in a semester.
  service: 500 * 60,
  // 80 study hours in one week.
  study: 80 * 60,
};

/** How many roles one measure can set apart with their own goal. */
export const GOAL_ROLE_LIMIT = 50;

/** Whether `target` is a goal this measure accepts (a whole number, 1 to its max). */
export function isGoalTarget(metric: GoalMetric, target: unknown): boolean {
  return (
    typeof target === "number" &&
    Number.isInteger(target) &&
    target >= 1 &&
    target <= GOAL_TARGET_MAX[metric]
  );
}
