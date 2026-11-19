/**
 * What already tracks each date in a minutes' Coming up (#5672; Paul,
 * 2026-11-19: "loves the Coming up dates and wants them tracked: reminders,
 * calendar, tasks for the right people").
 *
 * Both apps call it on what the viewer can already see, the chapter's events
 * and the tasks the server lists for them, so a date never names an event or
 * a task its reader couldn't open. Words, not a model, as for spotting a
 * task the chapter already has (`similar-task.ts`).
 */

import { meetingDueLabel } from "./meeting-copy";
import { SIMILAR_TASK_THRESHOLD, taskTitleLikeness } from "./similar-task";

export interface ComingUpEventCandidate {
  id: string;
  name: string;
  start_time: string;
}

export interface ComingUpTaskCandidate {
  id: string;
  title: string;
  /** `YYYY-MM-DD`. */
  due_date: string;
  assignee_id: string;
  status?: string | null;
  meeting_id?: string | null;
  /** Copies of one task for everyone share it, and count as one task. */
  group_id?: string | null;
}

export interface ComingUpDateTracking<
  E extends ComingUpEventCandidate,
  T extends ComingUpTaskCandidate,
> {
  /** The event on that day whose name is most like the date's words. */
  event: E | null;
  /** The tasks due that day made for it, one per task for everyone. */
  tasks: T[];
}

/**
 * Likeness at or above which an event on the same day is the date's own.
 * Lower than a task's: the day already narrows it to a handful, so "Winter
 * formal at the Hilton" is the day's "Formal" without every word agreeing.
 */
export const COMING_UP_EVENT_THRESHOLD = 0.5;

/** The viewer's calendar day of an instant, `YYYY-MM-DD`. */
export function localDayOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function comingUpTracking<
  E extends ComingUpEventCandidate,
  T extends ComingUpTaskCandidate,
>(
  dates: readonly { date: string; text: string }[],
  context: {
    meetingId: string;
    events: readonly E[];
    tasks: readonly T[];
  },
): ComingUpDateTracking<E, T>[] {
  const eventsByDay = new Map<string, E[]>();
  for (const event of context.events) {
    const day = localDayOf(event.start_time);
    if (!day) continue;
    eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event]);
  }
  return dates.map(({ date, text }) => {
    let event: E | null = null;
    let best = 0;
    for (const candidate of eventsByDay.get(date) ?? []) {
      const score = taskTitleLikeness(text, candidate.name);
      if (score >= COMING_UP_EVENT_THRESHOLD && score > best) {
        event = candidate;
        best = score;
      }
    }
    // A task made from these minutes for this day is the date's even when
    // its title was reworded; any other task due that day has to read alike.
    const groups = new Set<string>();
    const tasks = context.tasks.filter((task) => {
      if (task.due_date !== date) return false;
      const ours =
        (task.meeting_id != null && task.meeting_id === context.meetingId) ||
        taskTitleLikeness(text, task.title) >= SIMILAR_TASK_THRESHOLD;
      if (!ours) return false;
      if (!task.group_id) return true;
      if (groups.has(task.group_id)) return false;
      groups.add(task.group_id);
      return true;
    });
    return { event, tasks };
  });
}

/** The words of the Coming up ⋯ menu and its chips, on web and the phone. */
export const COMING_UP_COPY = {
  more: (text: string) => `More for ${text}`,
  addToCalendar: "Add to calendar",
  openEvent: "Open the event",
  makeTask: "Make a task",
  copyDate: "Copy date",
  copied: "Date copied",
  onCalendar: "On the calendar",
  task: (name: string | null) => (name ? `Task · ${name}` : "Task made"),
  tasks: (count: number) => `${count} tasks`,
} as const;

/** One chip under a date: what already tracks it. */
export interface ComingUpChip {
  key: "event" | "task";
  label: string;
}

/**
 * The chips under a date, in the order both apps draw them: the calendar
 * first, then the task ("Task · Jake", or "2 tasks" when several were made).
 * The viewer's own task names them "You", as the task list does.
 */
export function comingUpChips(
  tracking: ComingUpDateTracking<ComingUpEventCandidate, ComingUpTaskCandidate>,
  nameFor: (userId: string) => string | null,
  viewerId: string | null = null,
): ComingUpChip[] {
  const chips: ComingUpChip[] = [];
  if (tracking.event) {
    chips.push({ key: "event", label: COMING_UP_COPY.onCalendar });
  }
  const [only, ...rest] = tracking.tasks;
  if (only && rest.length === 0) {
    const name =
      only.assignee_id === viewerId ? "You" : nameFor(only.assignee_id);
    chips.push({ key: "task", label: COMING_UP_COPY.task(name) });
  } else if (only) {
    chips.push({
      key: "task",
      label: COMING_UP_COPY.tasks(tracking.tasks.length),
    });
  }
  return chips;
}

export type ComingUpMenuAction =
  "openEvent" | "addToCalendar" | "makeTask" | "copyDate";

/**
 * What a date's ⋯ menu offers, in order: the event when one is on that day
 * (anyone may open it), else Add to calendar for who may create events; Make
 * a task for who manages tasks; Copy date for everyone. Remind me joins it
 * in #5672's next step.
 */
export function comingUpMenu(input: {
  hasEvent: boolean;
  canCreateEvents: boolean;
  canManageTasks: boolean;
}): { action: ComingUpMenuAction; label: string }[] {
  const items: { action: ComingUpMenuAction; label: string }[] = [];
  if (input.hasEvent) {
    items.push({ action: "openEvent", label: COMING_UP_COPY.openEvent });
  } else if (input.canCreateEvents) {
    items.push({
      action: "addToCalendar",
      label: COMING_UP_COPY.addToCalendar,
    });
  }
  if (input.canManageTasks) {
    items.push({ action: "makeTask", label: COMING_UP_COPY.makeTask });
  }
  items.push({ action: "copyDate", label: COMING_UP_COPY.copyDate });
  return items;
}

/**
 * Where an event added from a date starts and ends: 7 PM that day, for an
 * hour, as a new event opens (both apps' default hour). The officer changes
 * it in the form.
 */
export function comingUpEventTimes(
  date: string,
): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const start = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    19,
  );
  return { start, end: new Date(start.getTime() + 60 * 60_000) };
}

/** "Wednesday, December 2: Philanthropy committee reports back". */
export function comingUpCopyText(
  item: { date: string; text: string },
  now: Date = new Date(),
): string {
  const day = meetingDueLabel(item.date, now);
  return day ? `${day}: ${item.text}` : item.text;
}
