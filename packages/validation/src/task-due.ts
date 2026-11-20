/**
 * A task with no due date (#5761, Shawn 2026-11-20: "you can just leave the
 * due date unspecified"), in the same words on both apps. Todoist, Things,
 * Asana and Linear all make a due date optional and call its absence "No
 * date" or "No due date"; Frapp says "No due date" because its field is Due.
 */

/**
 * The due field's empty value, its "take it off" choice, and the My tasks
 * group and Due filter that hold undated tasks.
 */
export const TASK_NO_DUE_DATE_LABEL = "No due date";

/**
 * Why a task with no due date can't repeat: a repeat counts from the task's
 * day. The Repeat control says it in place of its options on both apps, and
 * the API refuses with the same words.
 */
export const TASK_REPEAT_NEEDS_DUE_DATE = "Add a due date to repeat it";
