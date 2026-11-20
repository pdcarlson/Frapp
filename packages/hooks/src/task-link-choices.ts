import { formatDueLabel } from "@repo/formatting";
import { taskStatusLabel } from "./task-card";
import { compareTasksByDue } from "./task-views";
import type { TaskStatus } from "./use-tasks";

/** The fields of a task read the chat Task picker draws from. */
export interface TaskLinkSource {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string;
  due_at?: string | null;
  assignee_id: string;
  points_awarded?: boolean;
  sent_back_at?: string | null;
  completed_at?: string | null;
}

export interface TaskLinkChoice {
  id: string;
  title: string;
  /** "Moiz · Due Friday", or "Moiz · Done" for a finished one. */
  detail: string;
  done: boolean;
}

/** How many rows the picker shows; the field narrows past that. */
const TASK_LINK_CHOICE_LIMIT = 50;

/**
 * The chat + sheet's Task picker (#5772), on web and the phone: the tasks the
 * member can read, matched on the typed words, open ones first by when they
 * are due, then finished ones newest first. Each row says whose it is and
 * when it is due, so an officer with a hundred tasks can tell two "Clean the
 * kitchen"s apart. Comparable: Slack's and Linear's issue pickers, which
 * search by title and show the assignee and state on the row.
 */
export function taskLinkChoices(
  tasks: readonly TaskLinkSource[],
  query: string,
  nameOf: (userId: string) => string,
  now: Date = new Date(),
): TaskLinkChoice[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tasks.filter((task) => {
    const title = task.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
  const open = matches
    .filter((task) => task.status !== "COMPLETED")
    .sort(compareTasksByDue);
  const done = matches
    .filter((task) => task.status === "COMPLETED")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return [...open, ...done].slice(0, TASK_LINK_CHOICE_LIMIT).map((task) => {
    const isDone = task.status === "COMPLETED";
    const when = isDone
      ? taskStatusLabel({ ...task, points_awarded: !!task.points_awarded })
      : (formatDueLabel(task.due_at ?? task.due_date, now) ??
        taskStatusLabel({ ...task, points_awarded: false }));
    return {
      id: task.id,
      title: task.title,
      detail: `${nameOf(task.assignee_id)} · ${when}`,
      done: isDone,
    };
  });
}
