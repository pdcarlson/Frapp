import { dayDelta, formatDayHeading } from "@repo/formatting";
import {
  activityReviewRows,
  activityToDos,
  type Activity,
  type ActivityRow,
  type ActivitySection,
  type ActivityToDo,
} from "./activity-rows";

/**
 * The member's week (`GET /v1/activity`'s `week`,
 * `spec/behavior/activity.md` § Week). Absent from an API built before it.
 */
export type ActivityWeek = NonNullable<Activity["week"]>;

/** What the To do list can be narrowed to: one line of the week card. */
export type ActivityAgendaFilter = "all" | "events" | "tasks" | "answers";

/** One line under the week ring: a kind of thing, done of total. */
export interface ActivityWeekLine {
  id: Exclude<ActivityAgendaFilter, "all">;
  label: string;
  /** `null` when the part couldn't be read: drawn as a dash, never as 0. */
  done: number | null;
  total: number | null;
  /** For a screen reader: the line in one sentence. */
  spokenLabel: string;
}

export interface ActivityWeekSummary {
  /**
   * - `unknown`: the API doesn't serve the week yet, so there is no ring.
   * - `clear`: nothing was due this week and nothing is.
   * - `open`: something is left.
   * - `done`: everything that was due is done.
   */
  state: "unknown" | "clear" | "open" | "done";
  done: number;
  total: number;
  left: number;
  /** How far round the ring is, 0 to 1. */
  progress: number;
  /** A line per kind that has anything this week, or that couldn't load. */
  lines: ActivityWeekLine[];
  /**
   * A part couldn't be read, so the numbers may undercount: the page says
   * "at least", and never says the week is done or clear.
   */
  incomplete: boolean;
  /** The card's headline: "3 left this week", "All done this week". */
  headline: string;
  /**
   * Which part couldn't load, as a sentence: "Couldn't load tasks. Pull down
   * to try again." `null` when everything was read.
   */
  warning: string | null;
  /** For a screen reader: the ring in one sentence. */
  spokenLabel: string;
}

const things = (count: number) => (count === 1 ? "1 thing" : `${count} things`);

/** A name for a part of the week that could not be read. */
const WEEK_PART_NAMES: Record<ActivityWeek["unavailable"][number], string> = {
  events: "events",
  tasks: "tasks",
  polls: "polls",
  cards: "sign-ups and forms",
};

/** "tasks", "tasks and polls", "events, tasks and polls". */
const listed = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The top of the page (#4766): one ring, done of total this week, where the
 * count tiles were. Apple Fitness's rings and Bevel's daily dial close as the
 * day's work is done; this one closes on the week's events, tasks and
 * answers.
 *
 * A kind the chapter has off is served `null` and has no line. A kind with
 * nothing this week has none either: "Polls 0 of 0" is the zero tile again.
 * Polls and sign-ups share a line, since both are an answer the member owes.
 */
export function activityWeekSummary(activity: Activity): ActivityWeekSummary {
  const week = activity.week;
  if (!week) {
    return {
      state: "unknown",
      done: 0,
      total: 0,
      left: 0,
      progress: 0,
      lines: [],
      incomplete: false,
      headline: "",
      warning: null,
      spokenLabel: "",
    };
  }
  const failed = new Set(week.unavailable);
  const lines: ActivityWeekLine[] = [];
  const line = (
    id: ActivityWeekLine["id"],
    label: string,
    counts: ({ done: number; total: number } | null)[],
    down: boolean,
  ) => {
    const known = counts.filter((count) => count !== null);
    const done = known.reduce((sum, count) => sum + count.done, 0);
    const total = known.reduce((sum, count) => sum + count.total, 0);
    if (down && known.length === 0) {
      lines.push({
        id,
        label,
        done: null,
        total: null,
        spokenLabel: `${label}: couldn't load`,
      });
    } else if (total > 0 || down) {
      lines.push({
        id,
        label,
        done,
        total,
        spokenLabel: `${label}: ${done} of ${total} done`,
      });
    }
    return { done, total };
  };
  const counted = [
    line("events", "Events", [week.events], failed.has("events")),
    line("tasks", "Tasks", [week.tasks], failed.has("tasks")),
    line(
      "answers",
      "Polls and sign-ups",
      [week.polls, week.cards],
      failed.has("polls") || failed.has("cards"),
    ),
  ];
  const done = counted.reduce((sum, count) => sum + count.done, 0);
  const total = counted.reduce((sum, count) => sum + count.total, 0);
  const left = total - done;
  const incomplete = week.unavailable.length > 0;
  const state: ActivityWeekSummary["state"] =
    left > 0 ? "open" : incomplete ? "open" : total === 0 ? "clear" : "done";
  const headline =
    left > 0
      ? `${incomplete ? "At least " : ""}${left} left this week`
      : incomplete
        ? "Some of your week couldn't load"
        : total === 0
          ? "Nothing due this week"
          : "All done this week";
  return {
    state,
    done,
    total,
    left,
    progress: total === 0 ? 0 : Math.min(1, done / total),
    lines,
    incomplete,
    headline,
    warning: incomplete
      ? `Couldn't load ${listed(week.unavailable.map((part) => WEEK_PART_NAMES[part]))}. Pull down to try again.`
      : null,
    spokenLabel:
      total === 0
        ? headline
        : `${done} of ${things(total)} done this week. ${headline}.`,
  };
}

/** A day of the To do list, or one of its runs outside the calendar. */
export interface ActivityAgendaDay {
  /** `overdue`, `now`, `later`, `anytime`, or `day:<n>` (days from today). */
  id: string;
  /** "Overdue", "Now", "Today", "Tomorrow", "Sunday", "Later", "No deadline". */
  label: string;
  /** `warning` for Overdue, `accent` for Now; a day is plain. */
  tone: "warning" | "accent" | "plain";
  rows: ActivityRow[];
  /**
   * How many rows to draw before "Show more" (`null`: all of them). Overdue
   * and Now are never cut, and nothing is under a filter.
   */
  limit: number | null;
}

export interface ActivityAgenda {
  /**
   * The one thing to do next, for the week card: an event open for check-in,
   * else the first overdue task, else whatever is soonest. Its detail names
   * the day. `null` when the list is empty. It is not repeated in `days`.
   */
  next: ActivityRow | null;
  /**
   * What the card says over `next`: "Happening now" for an event open for
   * check-in, else "Next". An overdue task says so on its own row.
   */
  nextLabel: "Happening now" | "Next";
  days: ActivityAgendaDay[];
  /** Every row, `next` included, in order: what a sheet looks a key up in. */
  rows: ActivityRow[];
  /** Sections behind the list that could not be read this time. */
  unavailable: ActivitySection[];
}

/** How many rows a day draws before "Show more" (the president's Saturday). */
const AGENDA_DAY_LIMIT = 3;
/** Days ahead that get a heading of their own; anything further is Later. */
const AGENDA_DAY_HORIZON = 7;

const FILTER_KINDS: Record<
  Exclude<ActivityAgendaFilter, "all">,
  ActivityRow["kind"][]
> = {
  events: ["event"],
  tasks: ["task"],
  answers: ["poll", "card"],
};

const FILTER_SECTIONS: Record<ActivityAgendaFilter, ActivitySection[]> = {
  all: ["coming_up", "tasks", "polls", "cards"],
  events: ["coming_up"],
  tasks: ["tasks"],
  answers: ["polls", "cards"],
};

/**
 * The To do list by day (#4766): Overdue, Now, Today, Tomorrow, then each
 * day of the coming week, then Later and what has no deadline. Things' Today
 * and Todoist's Upcoming list by day; so do this app's own Events lists.
 * A row under a day says only its time.
 *
 * A filter narrows it to one line of the week card and lifts the per-day cap,
 * since the member asked for that kind; `next` stays the same under any
 * filter, so the week card doesn't change when its line is tapped.
 */
export function activityAgenda(
  activity: Activity,
  filter: ActivityAgendaFilter = "all",
  now: Date = new Date(),
): ActivityAgenda {
  const todos = activityToDos(activity, now);
  const bucketOf = (todo: ActivityToDo): { id: string; order: number } => {
    if (todo.now) return { id: "now", order: -1 };
    if (todo.overdue) return { id: "overdue", order: -2 };
    if (!todo.at) return { id: "anytime", order: AGENDA_DAY_HORIZON + 1 };
    // Earlier today, or a poll closing in the next minute: still today.
    const days = Math.max(0, dayDelta(now, todo.at));
    return days < AGENDA_DAY_HORIZON
      ? { id: `day:${days}`, order: days }
      : { id: "later", order: AGENDA_DAY_HORIZON };
  };
  const placed = todos
    .map((todo, index) => ({ todo, index, bucket: bucketOf(todo) }))
    .sort(
      (a, b) =>
        a.bucket.order - b.bucket.order ||
        // Within a run by time, then as the read ordered them. Nothing with
        // no time (`anytime`) reaches the comparison with one that has.
        (a.todo.at?.getTime() ?? 0) - (b.todo.at?.getTime() ?? 0) ||
        a.index - b.index,
    );
  // Now first, then Overdue, for the card; the list draws Overdue on top.
  const first =
    placed.find((item) => item.bucket.id === "now") ?? placed[0] ?? null;
  const next = first ? first.todo.dated : null;

  const kinds = filter === "all" ? null : FILTER_KINDS[filter];
  const days: ActivityAgendaDay[] = [];
  for (const item of placed) {
    if (item === first && filter === "all") continue;
    if (kinds && !kinds.includes(item.todo.dated.kind)) continue;
    const { id } = item.bucket;
    const isDay = id.startsWith("day:");
    let day = days.find((candidate) => candidate.id === id);
    if (!day) {
      day = {
        id,
        label:
          id === "overdue"
            ? "Overdue"
            : id === "now"
              ? "Now"
              : id === "later"
                ? "Later"
                : id === "anytime"
                  ? "No deadline"
                  : (formatDayHeading(item.todo.at?.toISOString(), now) ??
                    "Today"),
        tone: id === "overdue" ? "warning" : id === "now" ? "accent" : "plain",
        rows: [],
        limit: isDay && filter === "all" ? AGENDA_DAY_LIMIT : null,
      };
      days.push(day);
    }
    // Later keeps the date in the row; a day's rows say only the time, and
    // a row under Overdue doesn't repeat the heading as a chip.
    day.rows.push(
      isDay
        ? item.todo.timed
        : id === "overdue"
          ? { ...item.todo.dated, badge: null }
          : item.todo.dated,
    );
  }
  const down = new Set(activity.unavailable);
  return {
    next,
    nextLabel: first?.todo.now ? "Happening now" : "Next",
    days,
    rows: placed.map((item) => item.todo.dated),
    unavailable: FILTER_SECTIONS[filter].filter((section) => down.has(section)),
  };
}

/** What waits on the member's review, for the To review card. */
export interface ActivityReview {
  rows: ActivityRow[];
  /** "14", or "25+" when a list reached the read's cap. */
  count: string;
  /** "10 tasks · 4 hours entries". */
  detail: string;
  /** Sections behind it that could not be read this time. */
  unavailable: ActivitySection[];
}

const REVIEW_LIST_LIMIT = 25;

/**
 * The To review card (#4766), for a member who can confirm tasks or approve
 * hours: one card where two count tiles were, as Google Classroom gives a
 * teacher one "To review". `null` when nothing waits: a member, and an
 * officer with an empty queue, sees no card, not a zero.
 */
export function activityReview(
  activity: Activity,
  options: { canConfirmTasks: boolean; canApproveHours: boolean },
  now: Date = new Date(),
): ActivityReview | null {
  // The read serves these only to a member who may act on them, so rows are
  // shown as served: a slow permissions read must not hide an officer's
  // queue. The permissions decide only whose business a failed part is.
  const rows = activityReviewRows(activity, now);
  const down = new Set(activity.unavailable);
  const unavailable: ActivitySection[] = [
    ...(options.canConfirmTasks && down.has("tasks")
      ? (["tasks"] as const)
      : []),
    ...(options.canApproveHours && down.has("hours_approvals")
      ? (["hours_approvals"] as const)
      : []),
  ];
  if (rows.length === 0 && unavailable.length === 0) return null;
  const tasks = activity.needs_you.task_confirmations.length;
  const hours = activity.needs_you.hours_approvals.length;
  const capped = tasks >= REVIEW_LIST_LIMIT || hours >= REVIEW_LIST_LIMIT;
  const some = (count: number) =>
    count >= REVIEW_LIST_LIMIT ? `${REVIEW_LIST_LIMIT}+` : String(count);
  return {
    rows,
    count: capped ? `${rows.length}+` : String(rows.length),
    detail: [
      tasks > 0 ? `${some(tasks)} ${tasks === 1 ? "task" : "tasks"}` : null,
      hours > 0
        ? `${some(hours)} hours ${hours === 1 ? "entry" : "entries"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    unavailable,
  };
}
