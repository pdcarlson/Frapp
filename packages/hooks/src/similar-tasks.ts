import { useMemo, useState } from "react";
import { similarTask } from "@repo/validation";
import { isTaskStatus, taskDueLine, taskStatusLabel } from "./task-card";
import { useTasks, type TaskStatus } from "./use-tasks";

/**
 * Suggested tasks that read like a task the chapter already has open (#5562;
 * Paul, 2026-11-19), for both apps' suggestion cards, so the two match the
 * same tasks and say the same about them. The words rule is
 * `@repo/validation`'s `similarTask`; this reads the task list for it.
 */

/** A task off the task list, as much of it as the comparison shows. */
export interface ExistingTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** When it is due: the moment when there is one, else the day. */
  due: string | null;
  points_awarded: boolean;
  sent_back_at: string | null;
}

/**
 * The task list's rows as existing tasks. The list's read is typed loosely
 * (`useTasks`), so a row without an id, a title or a known status is skipped
 * rather than trusted.
 */
export function readExistingTasks(rows: unknown): ExistingTask[] {
  if (!Array.isArray(rows)) return [];
  const tasks: ExistingTask[] = [];
  for (const row of rows as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string") continue;
    if (!isTaskStatus(r.status)) continue;
    const due =
      typeof r.due_at === "string" && r.due_at
        ? r.due_at
        : typeof r.due_date === "string" && r.due_date
          ? r.due_date
          : null;
    tasks.push({
      id: r.id,
      title: r.title,
      status: r.status,
      due,
      points_awarded: r.points_awarded === true,
      sent_back_at:
        typeof r.sent_back_at === "string" && r.sent_back_at
          ? r.sent_back_at
          : null,
    });
  }
  return tasks;
}

/**
 * Where the existing task stands, as its own row says it: its status word
 * (Needs changes when sent back) and when it is due.
 */
export function existingTaskLine(
  task: ExistingTask,
  now: Date = new Date(),
): string {
  return [taskStatusLabel(task), taskDueLine(task.due, task.status, now)?.text]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The open task each waiting suggestion reads like, until the officer says
 * it is a different one. The task list is read only while there is a
 * suggestion to check, so a page with none waiting asks for nothing.
 */
export function useSimilarTasks(
  items: readonly { id: string; task: { title: string } }[],
) {
  const tasksQuery = useTasks({ enabled: items.length > 0 });
  // Suggestions the officer said are not the task they look like.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const twins = useMemo(() => {
    const existing = readExistingTasks(tasksQuery.data);
    return new Map(
      items.map((item) => [item.id, similarTask(item.task.title, existing)]),
    );
  }, [items, tasksQuery.data]);
  return {
    twinOf: (id: string): ExistingTask | null =>
      kept.has(id) ? null : (twins.get(id) ?? null),
    /** Create anyway: this suggestion is not that task. */
    keep: (id: string) => setKept((previous) => new Set(previous).add(id)),
    /**
     * Whether the task list has been read, so a suggestion with no twin
     * truly has none (or could not be, and the check is off). Until then a
     * bulk create waits.
     */
    known: tasksQuery.data !== undefined || tasksQuery.isError,
  };
}
