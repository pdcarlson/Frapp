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

import { meetingDueLabel, meetingLocalDay } from "./meeting-copy";

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
  /** Copies of one task for several people share it, and count as one. */
  group_id?: string | null;
}

export interface ComingUpDateTracking<
  E extends ComingUpEventCandidate,
  T extends ComingUpTaskCandidate,
> {
  /** The event on that day whose name shares the most words with the date. */
  event: E | null;
  /**
   * The tasks due that day about the same thing, one per task given to
   * several people, with how many people it went to.
   */
  tasks: (T & { people: number })[];
}

/** Words that say nothing about what a date is for. */
const FILLER = new Set([
  "and",
  "are",
  "for",
  "from",
  "the",
  "our",
  "out",
  "this",
  "that",
  "will",
  "with",
  "due",
  "day",
  "meeting",
  "chapter",
  "back",
  "next",
  "week",
]);

/**
 * The words that say what a line is about: lowercased, a possessive and a
 * plural's "s" taken off, three letters or more, filler left out. "Winter
 * formal at the Hilton" is {winter, formal, hilton}.
 */
function aboutWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’]+/u)) {
    let word = raw.replace(/['’]s?$/u, "");
    if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) {
      word = word.slice(0, -1);
    }
    if (word.length >= 3 && !FILLER.has(word)) out.add(word);
  }
  return out;
}

function sharedWords(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared;
}

/**
 * For each date: the event that day and the tasks due that day that share a
 * word of what it is about. The day already narrows it to a handful, so one
 * shared word is enough: "Formal" is the day's "Winter formal at the Hilton",
 * and "Collect dues from brothers" is the day's "Dues to the treasurer",
 * while a task due that day about something else ("Order pledge pins") is
 * not.
 */
export function comingUpTracking<
  E extends ComingUpEventCandidate,
  T extends ComingUpTaskCandidate,
>(
  dates: readonly { date: string; text: string }[],
  context: { events: readonly E[]; tasks: readonly T[] },
): ComingUpDateTracking<E, T>[] {
  const eventsByDay = new Map<string, E[]>();
  for (const event of context.events) {
    if (Number.isNaN(new Date(event.start_time).getTime())) continue;
    const day = meetingLocalDay(event.start_time);
    eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event]);
  }
  const people = new Map<string, number>();
  for (const task of context.tasks) {
    if (task.group_id) {
      people.set(task.group_id, (people.get(task.group_id) ?? 0) + 1);
    }
  }
  return dates.map(({ date, text }) => {
    const about = aboutWords(text);
    let event: E | null = null;
    let best = 0;
    for (const candidate of eventsByDay.get(date) ?? []) {
      const shared = sharedWords(about, aboutWords(candidate.name));
      if (shared > best) {
        event = candidate;
        best = shared;
      }
    }
    const groups = new Set<string>();
    const tasks: (T & { people: number })[] = [];
    for (const task of context.tasks) {
      if (task.due_date !== date) continue;
      if (sharedWords(about, aboutWords(task.title)) === 0) continue;
      if (task.group_id) {
        if (groups.has(task.group_id)) continue;
        groups.add(task.group_id);
      }
      tasks.push({
        ...task,
        people: task.group_id ? (people.get(task.group_id) ?? 1) : 1,
      });
    }
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
  copyFailed: "Couldn't copy the date",
  onCalendar: "On the calendar",
  task: (name: string | null) => (name ? `Task · ${name}` : "Task made"),
  taskForPeople: (count: number) => `Task · ${count} people`,
  tasks: (count: number) => `${count} tasks`,
} as const;

/** One chip under a date: what already tracks it. */
export interface ComingUpChip {
  key: "event" | "task";
  label: string;
}

/**
 * The chips under a date, in the order both apps draw them: the calendar
 * first, then the task: whose it is ("Task · Jake", "Task · You" for the
 * viewer's own), how many it went to ("Task · 12 people"), or "2 tasks".
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
    chips.push({
      key: "task",
      label:
        only.people > 1
          ? COMING_UP_COPY.taskForPeople(only.people)
          : COMING_UP_COPY.task(
              only.assignee_id === viewerId ? "You" : nameFor(only.assignee_id),
            ),
    });
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
 * What a date's ⋯ offers, in order: the event when one is on that day
 * (anyone who can see it may open it), else Add to calendar for who may
 * create events; Make a task for who manages tasks; Copy date for everyone.
 * A day already gone offers neither create, since both forms refuse a time
 * that has passed. Remind me joins it in #5672's next step.
 */
export function comingUpMenu(input: {
  hasEvent: boolean;
  /** The day is today or later. */
  upcoming: boolean;
  canCreateEvents: boolean;
  canManageTasks: boolean;
}): { action: ComingUpMenuAction; label: string }[] {
  const items: { action: ComingUpMenuAction; label: string }[] = [];
  if (input.hasEvent) {
    items.push({ action: "openEvent", label: COMING_UP_COPY.openEvent });
  } else if (input.canCreateEvents && input.upcoming) {
    items.push({
      action: "addToCalendar",
      label: COMING_UP_COPY.addToCalendar,
    });
  }
  if (input.canManageTasks && input.upcoming) {
    items.push({ action: "makeTask", label: COMING_UP_COPY.makeTask });
  }
  items.push({ action: "copyDate", label: COMING_UP_COPY.copyDate });
  return items;
}

/** Whether a `YYYY-MM-DD` day is today or later, on the viewer's calendar. */
export function comingUpIsAhead(date: string, now: Date = new Date()): boolean {
  return date >= meetingLocalDay(now.toISOString());
}

/** The hour a new event opens at on the phone's form, and here. */
const EVENT_START_HOUR = 19;

/**
 * Where an event added from a date starts and ends: 7 PM that day, for an
 * hour, as the phone's New event opens; today after 7 PM, the next quarter
 * hour, since the forms refuse a start that has passed. Null for a day
 * already gone. The officer changes it in the form.
 */
export function comingUpEventTimes(
  date: string,
  now: Date = new Date(),
): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !comingUpIsAhead(date, now)) return null;
  let start = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    EVENT_START_HOUR,
  );
  if (start <= now) {
    const quarter = 15 * 60_000;
    start = new Date(Math.ceil((now.getTime() + 1) / quarter) * quarter);
  }
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
