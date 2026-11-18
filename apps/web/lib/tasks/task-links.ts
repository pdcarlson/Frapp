/**
 * The Tasks board's links that open its task panel (#5538). Activity's Tasks
 * you assigned row for a task for everyone links to `/tasks?group=<group id>`,
 * since the board's panel is the one place on web that shows a group
 * (`spec/behavior/tasks.md` § Tasks for everyone); a review link Activity
 * can't open itself goes to `/tasks?task=<task id>`, which opens that task,
 * or its group when it is a copy of one. The board reads either param once
 * its read holds the task and drops it from the address.
 */
export const TASKS_GROUP_PARAM = "group";
export const TASKS_TASK_PARAM = "task";

/** `/tasks?group=<id>`: the board, with that group open in its panel. */
export function tasksGroupLink(groupId: string): string {
  const params = new URLSearchParams({ [TASKS_GROUP_PARAM]: groupId });
  return `/tasks?${params.toString()}`;
}

/** `/tasks?task=<id>`: the board, with that task (or its group) open. */
export function tasksTaskLink(taskId: string): string {
  const params = new URLSearchParams({ [TASKS_TASK_PARAM]: taskId });
  return `/tasks?${params.toString()}`;
}
