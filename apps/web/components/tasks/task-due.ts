import { taskDueLine } from "@repo/hooks";
import type { TaskStatus } from "@repo/hooks";

/**
 * The due clause of a task tile's meta line: `@repo/hooks`' `taskDueLine`,
 * the rule both apps' chat task cards read too (#4135), so a task's due line
 * reads the same on the board and in chat. A task due at a time counts down
 * to that minute (#4003).
 *
 * `null` for a missing or unparseable date, so the clause drops out of the
 * line rather than printing a placeholder.
 */
export function taskDueClause(
  task: {
    due_date: string | null | undefined;
    due_at?: string | null;
    status: TaskStatus;
  },
  now: Date = new Date(),
): { text: string; overdue: boolean } | null {
  return taskDueLine(task.due_at ?? task.due_date, task.status, now);
}
