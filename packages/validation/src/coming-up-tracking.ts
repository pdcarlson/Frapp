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

import { TASK_TITLE_MAX_LENGTH } from "./field-limits";
import { meetingDueLabel, meetingLocalDay } from "./meeting-copy";
import {
  suggestTaskOwner,
  type GuessableMember,
} from "./task-suggestion-guess";

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
  remindMe: "Remind me",
  cancelReminder: "Cancel reminder",
  reminder: (at: Date) => `Reminder · ${comingUpReminderWhen(at)}`,
  reminderSet: (at: Date) => `We'll remind you ${comingUpReminderWhen(at)}`,
  reminderSetFailed: "Couldn't set the reminder",
  reminderCanceled: "Reminder canceled",
  reminderCancelFailed: "Couldn't cancel the reminder",
} as const;

/** One chip under a date: what already tracks it. */
export interface ComingUpChip {
  key: "event" | "task" | "reminder";
  label: string;
}

/**
 * The chips under a date, in the order both apps draw them: the calendar
 * first, then the task: whose it is ("Task · Jake", "Task · You" for the
 * viewer's own), how many it went to ("Task · 12 people"), or "2 tasks";
 * then the viewer's own reminder ("Reminder · December 3, 6 PM").
 */
export function comingUpChips(
  tracking: ComingUpDateTracking<ComingUpEventCandidate, ComingUpTaskCandidate>,
  nameFor: (userId: string) => string | null,
  viewerId: string | null = null,
  reminder: { remind_at: string } | null = null,
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
  if (reminder) {
    chips.push({
      key: "reminder",
      label: COMING_UP_COPY.reminder(new Date(reminder.remind_at)),
    });
  }
  return chips;
}

export type ComingUpMenuAction =
  | "remindMe"
  | "cancelReminder"
  | "openEvent"
  | "addToCalendar"
  | "makeTask"
  | "copyDate";

/**
 * What a date's ⋯ offers, in order: Remind me for every reader while a
 * reminder can still come before the day (Cancel reminder once they set
 * one); the event when one is on that day (anyone who can see it may open
 * it), else Add to calendar for who may create events; Make a task for who
 * manages tasks; Copy date for everyone. A day already gone offers neither
 * create, since both forms refuse a time that has passed.
 */
export function comingUpMenu(input: {
  hasEvent: boolean;
  /** The day is today or later. */
  upcoming: boolean;
  canCreateEvents: boolean;
  canManageTasks: boolean;
  /** The viewer set a reminder on this date. */
  hasReminder?: boolean;
  /** A reminder could still come before the day (`comingUpReminderTime`). */
  canRemind?: boolean;
}): { action: ComingUpMenuAction; label: string }[] {
  const items: { action: ComingUpMenuAction; label: string }[] = [];
  if (input.hasReminder) {
    items.push({
      action: "cancelReminder",
      label: COMING_UP_COPY.cancelReminder,
    });
  } else if (input.canRemind) {
    items.push({ action: "remindMe", label: COMING_UP_COPY.remindMe });
  }
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

/** The hour of the evening before that a reminder comes, as a planner's would. */
const REMINDER_EVENING_HOUR = 18;
/** The hour of the day itself, when the evening before has passed. */
const REMINDER_MORNING_HOUR = 9;

/** How far ahead the API takes a reminder (`reminder-window.ts`). */
const REMINDER_MAX_AHEAD_DAYS = 365;

/**
 * When Remind me reminds, on the viewer's calendar: 6 PM the evening before,
 * or 9 AM on the day once that has passed. Null once both have, or for a
 * day gone: the date is under way, and a reminder would only be noise. Null
 * too for a day the API would refuse: more than a year off, or one that
 * doesn't exist ("2026-02-30").
 */
export function comingUpReminderTime(
  date: string,
  now: Date = new Date(),
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ];
  const morning = new Date(year, month, day, REMINDER_MORNING_HOUR);
  if (morning.getMonth() !== month || morning.getDate() !== day) return null;
  const latest = now.getTime() + REMINDER_MAX_AHEAD_DAYS * 24 * 60 * 60_000;
  const evening = new Date(year, month, day - 1, REMINDER_EVENING_HOUR);
  const at = evening > now ? evening : morning > now ? morning : null;
  return at && at.getTime() <= latest ? at : null;
}

/** "December 3, 6 PM", or "December 3, 6:30 PM": when a reminder comes. */
export function comingUpReminderWhen(at: Date): string {
  const day = at.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  const time = at
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
  return `${day}, ${time}`;
}

/** The viewer's reminder on a date: the one set on its day and words. */
export function comingUpReminderFor<R extends { date: string; text: string }>(
  reminders: readonly R[],
  item: { date: string; text: string },
): R | null {
  const text = item.text.trim();
  return (
    reminders.find(
      (reminder) => reminder.date === item.date && reminder.text === text,
    ) ?? null
  );
}

/** "Wednesday, December 2: Philanthropy committee reports back". */
export function comingUpCopyText(
  item: { date: string; text: string },
  now: Date = new Date(),
): string {
  const day = meetingDueLabel(item.date, now);
  return day ? `${day}: ${item.text}` : item.text;
}

/** The words of the review that follows Post (#5672 step 3), on both apps. */
export const COMING_UP_REVIEW_COPY = {
  title: "Track the dates from this meeting?",
  description:
    "Frapp guessed what each date needs. Uncheck anything you don't want.",
  taskFor: (name: string | null) =>
    name ? `Task for ${name}` : "Task for you",
  due: (title: string, date: string) => {
    const day = meetingDueLabel(date);
    return day ? `${title} · due ${day}` : title;
  },
  onCalendar: "Already on the calendar",
  onCalendarDetail: (name: string, date: string) => {
    const day = meetingDueLabel(date);
    return `${day ? `${name} · ${day}` : name}. Nothing to add.`;
  },
  skip: "Skip",
  track: (count: number) => `Track ${count}`,
  made: (count: number) =>
    count === 1 ? "Made 1 task" : `Made ${count} tasks`,
  failed: (count: number) =>
    count === 1 ? "Couldn't make 1 task" : `Couldn't make ${count} tasks`,
  failedDetail: "Make it from the date's ⋯ menu.",
} as const;

/** One line of the review: a task to make, or a date already on the calendar. */
export interface ComingUpReviewRow {
  /** The date's place in the minutes' Coming up, from 0. */
  index: number;
  date: string;
  text: string;
  kind: "task" | "calendar";
  /** The task's title, or the event's name for a calendar line. */
  title: string;
  /** The whole line, when the title had to be cut to fit a task's. */
  description: string | null;
  /** Who the task is for; null for the officer who posted. */
  assigneeId: string | null;
  /**
   * The suggested task the date's action item already became, which the
   * review accepts instead of making a second task for the same thing.
   */
  suggestion: {
    id: string;
    due_date: string | null;
    assignee_id: string | null;
  } | null;
  /** Ticked to begin with: a task whose owner was named or guessed. */
  checked: boolean;
}

/**
 * A date's words as a task's title: whole when they fit, else cut at a word
 * with an ellipsis (the whole line goes in the description), as a suggested
 * task's title is cut from its action item.
 */
function taskTitleFrom(text: string): string {
  if (text.length <= TASK_TITLE_MAX_LENGTH) return text;
  const cut = text.slice(0, TASK_TITLE_MAX_LENGTH - 1);
  const atWord = cut.replace(/\s+\S*$/u, "");
  return `${(atWord.length > TASK_TITLE_MAX_LENGTH / 2 ? atWord : cut).trimEnd()}…`;
}

/** A waiting suggested task, as the review reads it. */
export interface ComingUpReviewSuggestion {
  id: string;
  quote: string | null;
  task: {
    title: string;
    assignee_id: string | null;
    assignee_ids?: readonly string[] | null;
    audience?: string | null;
    due_date: string | null;
  } | null;
}

/**
 * What the review offers once minutes are posted (#5672; Paul picked "Review
 * at Post", 2026-11-19): for each Coming up date still ahead that nothing
 * tracks yet, a task due that day, ticked when the minutes say whose it is.
 * Whose: the owner of the action item about the same thing (due that day or
 * undated), else a member the date's own words name, else the officer who
 * posted, unticked. When that action item already became a suggested task,
 * the line accepts it, so the date never makes a second task for one job.
 * A date already on the calendar is shown, with nothing to tick; a date
 * already a task is left out. Words, not a model, as the chips match them.
 */
export function comingUpPostReview(input: {
  dates: readonly { date: string; text: string }[];
  tracking: readonly ComingUpDateTracking<
    ComingUpEventCandidate,
    ComingUpTaskCandidate
  >[];
  actionItems: readonly {
    text: string;
    owner_user_id: string | null;
    due_date: string | null;
  }[];
  suggestions: readonly ComingUpReviewSuggestion[];
  members: readonly GuessableMember[];
  now?: Date;
}): ComingUpReviewRow[] {
  const now = input.now ?? new Date();
  const taken = new Set<string>();
  const rows: ComingUpReviewRow[] = [];
  input.dates.forEach(({ date, text }, index) => {
    const track = input.tracking[index];
    if (!track || !comingUpIsAhead(date, now) || track.tasks.length > 0) {
      return;
    }
    const base = { index, date, text: text.trim() };
    if (track.event) {
      rows.push({
        ...base,
        kind: "calendar",
        title: track.event.name,
        description: null,
        assigneeId: null,
        suggestion: null,
        checked: false,
      });
      return;
    }
    const about = aboutWords(text);
    let item: (typeof input.actionItems)[number] | null = null;
    let best = 0;
    for (const candidate of input.actionItems) {
      if (candidate.due_date !== null && candidate.due_date !== date) continue;
      const shared = sharedWords(about, aboutWords(candidate.text));
      if (shared > best) {
        item = candidate;
        best = shared;
      }
    }
    const suggestion = item
      ? input.suggestions.find(
          (s) =>
            s.task !== null &&
            !taken.has(s.id) &&
            s.quote?.trim() === item!.text.trim(),
        )
      : undefined;
    // A suggestion for a group stays in Suggested tasks, where its Who is
    // the officer's to set; the review only makes tasks for one person.
    const forGroup =
      !!suggestion?.task &&
      (!!suggestion.task.audience ||
        (suggestion.task.assignee_ids?.length ?? 0) > 1);
    if (forGroup) return;
    if (suggestion) taken.add(suggestion.id);
    // The minutes' own owner first; a name in the date's words is a guess.
    const owner =
      suggestion?.task?.assignee_id ??
      item?.owner_user_id ??
      suggestTaskOwner(text, input.members);
    const title = suggestion?.task?.title ?? taskTitleFrom(base.text);
    rows.push({
      ...base,
      kind: "task",
      title,
      description: suggestion || title === base.text ? null : base.text,
      assigneeId: owner,
      suggestion: suggestion?.task
        ? {
            id: suggestion.id,
            due_date: suggestion.task.due_date,
            assignee_id: suggestion.task.assignee_id,
          }
        : null,
      checked: owner !== null,
    });
  });
  return rows;
}
