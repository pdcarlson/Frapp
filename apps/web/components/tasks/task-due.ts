import { formatDay, formatDueLabel } from "@repo/formatting";
import type { TaskStatus } from "@repo/hooks";

/**
 * The due clause of a task tile's meta line, in mobile's `formatDueSubtitle`
 * wording ("Due tomorrow", "Due Friday", "Overdue by 2 days") through the
 * shared `formatDueLabel`, which reads the bare `due_date` at local noon so it
 * keeps its calendar day in every zone.
 *
 * A task awaiting confirmation has been handed in, so "Overdue by 3 days"
 * would read as a charge against finished work: past its date it reads
 * "Due Sep 3" instead, and never takes the destructive tone.
 *
 * `null` for a missing or unparseable date, so the clause drops out of the
 * line rather than printing a placeholder.
 */
export function taskDueClause(
  task: { due_date: string | null | undefined; status: TaskStatus },
  now: Date = new Date(),
): { text: string; overdue: boolean } | null {
  const label = formatDueLabel(task.due_date, now);
  if (!label) return null;
  const pastDue = label.startsWith("Overdue");
  if (task.status === "COMPLETED") {
    if (!pastDue) return { text: label, overdue: false };
    const day = formatDay(task.due_date, now);
    return day ? { text: `Due ${day}`, overdue: false } : null;
  }
  return { text: label, overdue: pastDue || task.status === "OVERDUE" };
}
