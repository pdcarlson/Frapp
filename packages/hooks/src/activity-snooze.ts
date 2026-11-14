import { formatRelativeDayTime } from "@repo/formatting";
import {
  activityGroups,
  activityReviewRows,
  activityToDos,
  type Activity,
  type ActivityItemRef,
  type ActivityRow,
} from "./activity-rows";

/**
 * Snooze on Activity (#4982, item 7 of #4402; `spec/behavior/activity.md` §
 * Snooze): a row that waits on the member leaves their list until a time
 * they pick, then comes back, as Gmail's Snooze and Slack's Later do. The
 * read serves a snoozed row with `snoozed_until`; these helpers keep it off
 * the list on the client's own clock, so it comes back within a tick of its
 * time without a re-read.
 */

/**
 * Whether a row can be snoozed: one that waits on the member (To do, To
 * review, Links), never Waiting on others, which waits on someone else.
 */
export function activityRowSnoozable(
  row: Pick<ActivityRow, "key"> & { readRef?: ActivityItemRef | null },
): boolean {
  // A reminder (#4957) names no item (`readRef` null): it has its own Snooze.
  return row.readRef !== null && !row.key.startsWith("made:");
}

/** Whether a row's snooze still holds at `now`. */
function asleep(row: { snoozed_until?: string | null }, now: Date): boolean {
  if (!row.snoozed_until) return false;
  const until = Date.parse(row.snoozed_until);
  return !Number.isNaN(until) && until > now.getTime();
}

/** The `kind:id` a snooze names, by the same rule as a read. */
function refKey(ref: ActivityItemRef): string {
  return `${ref.kind}:${ref.item_id}`;
}

/**
 * Applies `fn` to every waiting list of the read, each row with the
 * `kind:id` its snooze or read is named by. A task can sit in two lists, and
 * a poll or card is named by its message.
 */
function mapWaiting(
  activity: Activity,
  fn: <T extends { snoozed_until?: string | null }>(
    rows: T[],
    key: (row: T) => string,
  ) => T[],
): Activity {
  const task = (row: { id: string }) => `task:${row.id}`;
  return {
    ...activity,
    needs_you: {
      ...activity.needs_you,
      tasks: fn(activity.needs_you.tasks, task),
      task_confirmations: fn(activity.needs_you.task_confirmations, task),
      hours_approvals: fn(
        activity.needs_you.hours_approvals,
        (row) => `hours_entry:${row.id}`,
      ),
      polls: fn(activity.needs_you.polls, (row) => `poll:${row.message_id}`),
      // A read cached before cards were served has none.
      cards: fn(
        activity.needs_you.cards ?? [],
        (row) => `${row.kind === "form" ? "form" : "signup"}:${row.message_id}`,
      ),
    },
    coming_up: fn(activity.coming_up, (row) => `event:${row.id}`),
    links: fn(activity.links, (row) => `link:${row.id}`),
  };
}

/**
 * The read with nothing snoozed at `now` in it: what the page lists. The
 * week ring is drawn from the whole read, since snoozing something doesn't
 * finish it.
 */
export function activityAwake(activity: Activity, now: Date): Activity {
  return mapWaiting(activity, (rows) =>
    rows.some((row) => asleep(row, now))
      ? rows.filter((row) => !asleep(row, now))
      : rows,
  );
}

/** The read with this item snoozed until `until`, or woken when `null`. */
export function setActivitySnooze(
  activity: Activity,
  ref: ActivityItemRef,
  until: string | null,
): Activity {
  const target = refKey(ref);
  return mapWaiting(activity, (rows, key) =>
    rows.map((row) =>
      key(row) === target ? { ...row, snoozed_until: until } : row,
    ),
  );
}

/**
 * The member's snoozed rows, soonest back first, for the Snoozed group at
 * the foot of the page. Each says when it comes back in place of its detail,
 * carries no ask and no dot, and keeps its record's key, so a panel opened
 * on one finds it again once it is back.
 */
export function activitySnoozedRows(
  activity: Activity,
  now: Date,
): ActivityRow[] {
  const snoozed = mapWaiting(activity, (rows) =>
    rows.filter((row) => asleep(row, now)),
  );
  const rows = [
    ...activityReviewRows(snoozed, now),
    ...activityToDos(snoozed, now).map((todo) => todo.dated),
    ...(activityGroups(snoozed, now).find((group) => group.id === "links")
      ?.rows ?? []),
  ];
  const untilOf = (row: ActivityRow) => {
    // A reminder (#4957) is put off with its own Snooze, never this one.
    if (row.kind === "reminder") return null;
    const record =
      row.kind === "task"
        ? row.task
        : row.kind === "poll"
          ? row.poll
          : row.kind === "event"
            ? row.event
            : row.kind === "hours"
              ? row.entry
              : row.kind === "link"
                ? row.link
                : row.card;
    return record.snoozed_until ?? null;
  };
  return rows
    .map((row) => ({ row, until: untilOf(row) }))
    .filter(
      (entry): entry is { row: ActivityRow; until: string } =>
        entry.until !== null,
    )
    .sort((a, b) => Date.parse(a.until) - Date.parse(b.until))
    .map(({ row, until }) => ({
      ...row,
      detail: `Back ${activitySnoozeTimeLabel(until, now)}`,
      soon: null,
      badge: null,
      unread: false,
    }));
}

/** "Tomorrow · 8:00 AM", or the raw value if it doesn't parse. */
function activitySnoozeTimeLabel(until: string, now: Date): string {
  return formatRelativeDayTime(until, now) ?? until;
}

/** One of the fixed times a row can be snoozed to. */
export interface ActivitySnoozeOption {
  id: "later-today" | "tomorrow" | "weekend" | "next-week";
  label: string;
  /** "Today · 6:00 PM", "Saturday · 8:00 AM": when it comes back, in full. */
  hint: string;
  /**
   * The label with its time, for a menu: "Later today · 6:00 PM",
   * "This weekend · Saturday 8:00 AM" (the day only where the label doesn't
   * already say it).
   */
  menuLabel: string;
  until: Date;
}

/** The hour a morning snooze comes back, as Gmail's do. */
const MORNING_HOUR = 8;
/** The hour Later today comes back. */
const EVENING_HOUR = 18;

function atHour(day: Date, hour: number): Date {
  const at = new Date(day);
  at.setHours(hour, 0, 0, 0);
  return at;
}

function addDays(day: Date, days: number): Date {
  const at = new Date(day);
  at.setDate(at.getDate() + days);
  return at;
}

/**
 * The times a row can be snoozed to from `now`, in the member's own time
 * zone, Gmail's set: Later today (6 PM, while that is more than an hour
 * off), Tomorrow (8 AM), This weekend (Saturday 8 AM, Monday to Thursday)
 * and Next week (Monday 8 AM). Fixed times rather than a picker, since one
 * press is the point.
 */
export function activitySnoozeOptions(
  now: Date = new Date(),
): ActivitySnoozeOption[] {
  const options: ActivitySnoozeOption[] = [];
  const hint = (until: Date) =>
    activitySnoozeTimeLabel(until.toISOString(), now);
  const option = (
    id: ActivitySnoozeOption["id"],
    label: string,
    until: Date,
    // Later today and Tomorrow name their day; the rest name it in the time.
    withDay: boolean,
  ): ActivitySnoozeOption => {
    const full = hint(until);
    const time = withDay
      ? full.replace(" · ", " ")
      : full.replace(/^.*? · /, "");
    return { id, label, hint: full, menuLabel: `${label} · ${time}`, until };
  };
  const evening = atHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > 60 * 60 * 1000) {
    options.push(option("later-today", "Later today", evening, false));
  }
  const tomorrow = atHour(addDays(now, 1), MORNING_HOUR);
  options.push(option("tomorrow", "Tomorrow", tomorrow, false));
  const weekday = now.getDay(); // 0 Sunday … 6 Saturday
  if (weekday >= 1 && weekday <= 4) {
    const saturday = atHour(addDays(now, 6 - weekday), MORNING_HOUR);
    options.push(option("weekend", "This weekend", saturday, true));
  }
  const monday = atHour(addDays(now, (8 - weekday) % 7 || 7), MORNING_HOUR);
  // On a Sunday next week is tomorrow morning, already offered.
  if (monday.getTime() === tomorrow.getTime()) return options;
  options.push(option("next-week", "Next week", monday, true));
  return options;
}

/**
 * When the soonest snooze in the read ends, or `null` when nothing is
 * snoozed past `now`. A screen reads Activity again then, so the row comes
 * back with its dot and the badge counts it (`useActivitySnoozeWake`).
 */
export function activityNextWake(activity: Activity, now: Date): Date | null {
  let soonest: number | null = null;
  mapWaiting(activity, (rows) => {
    for (const row of rows) {
      if (!asleep(row, now) || !row.snoozed_until) continue;
      const until = Date.parse(row.snoozed_until);
      if (soonest === null || until < soonest) soonest = until;
    }
    return rows;
  });
  return soonest === null ? null : new Date(soonest);
}
