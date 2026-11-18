/**
 * The Tasks board's link that opens a task for everyone in its task panel
 * (#5538): `/tasks?group=<group id>`. Activity's Tasks you assigned row
 * links here, since the board's panel is the one place on web that shows a
 * group (`spec/behavior/tasks.md` § Tasks for everyone). The board reads the
 * param once its read holds the group and drops it from the address.
 */
export const TASKS_GROUP_PARAM = "group";

/** `/tasks?group=<id>`: the board, with that group open in its panel. */
export function tasksGroupLink(groupId: string): string {
  const params = new URLSearchParams({ [TASKS_GROUP_PARAM]: groupId });
  return `/tasks?${params.toString()}`;
}
