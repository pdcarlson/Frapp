/**
 * Narrowing and grouping for s14 (Notifications), over `GET /v1/notifications`.
 *
 * ## The category label is derived, not read
 *
 * The reference draws a category under each row — "Events · 4:00 PM". A
 * notification row does **not** store its category: `NotificationService`
 * persists `data: payload.data ?? {}` and forwards `category` only to the push
 * provider, for delivery telemetry. What the row does carry is the deep-link
 * target every payload includes (`spec/behavior/notifications.md` § Deep
 * Linking), so the label is derived from `data.target.screen`. That is the
 * honest source; inventing a category from the title's wording would not be.
 *
 * Rows whose target names no known screen fall back to no label rather than to
 * a guessed one.
 */
import { isRecord, records, str } from "./narrow";

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  /** `null` when the row carries no recognizable target. */
  categoryLabel: string | null;
  /** Local clock time, e.g. `"4:00 PM"`. */
  time: string;
  createdAt: string;
  isUnread: boolean;
}

export interface NotificationGroup {
  /** `TODAY` / `EARLIER`, as drawn. */
  heading: string;
  rows: NotificationRow[];
}

/**
 * `data.target.screen` → the label drawn under a row.
 *
 * Keyed on the screen names the API actually emits — grepping `target: {` across
 * `apps/api/src` yields `chat`, `service`, and the event/task/points/billing
 * destinations. Anything unmapped gets no label.
 */
const SCREEN_LABELS: Record<string, string> = {
  chat: "Chat",
  event: "Events",
  events: "Events",
  "event-details": "Events",
  task: "Tasks",
  tasks: "Tasks",
  points: "Points",
  billing: "Billing",
  dues: "Billing",
  service: "Service hours",
  study: "Study hours",
};

function targetScreen(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const target = data.target;
  return isRecord(target) ? str(target, "screen") : null;
}

export function categoryLabelFor(data: unknown): string | null {
  const screen = targetScreen(data);
  return screen ? (SCREEN_LABELS[screen] ?? null) : null;
}

function formatTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `Mon`, `Aug 12` — what an older row shows in place of a clock time. */
function formatDay(value: string, now: Date): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const withinAWeek = now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000;
  return withinAWeek
    ? date.toLocaleDateString(undefined, { weekday: "short" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toRow(
  row: Record<string, unknown>,
  now: Date,
): (NotificationRow & { isToday: boolean }) | null {
  const id = str(row, "id");
  const title = str(row, "title");
  const createdAt = str(row, "created_at");
  if (!id || !title || !createdAt) return null;

  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const isToday = isSameLocalDay(created, now);

  return {
    id,
    title,
    body: str(row, "body"),
    categoryLabel: categoryLabelFor(row.data),
    time: (isToday ? formatTime(createdAt) : formatDay(createdAt, now)) ?? "",
    createdAt,
    // `read_at` is nullable and set on read; absent means unread.
    isUnread: str(row, "read_at") === null,
    isToday,
  };
}

/**
 * Rows grouped TODAY / EARLIER, newest first within each, as drawn.
 *
 * Empty groups are dropped so a member with only older activity does not see a
 * TODAY heading over nothing.
 */
export function selectNotificationGroups(
  data: unknown,
  now: Date,
): NotificationGroup[] {
  const rows = records(data)
    .map((row) => toRow(row, now))
    .filter((row): row is NotificationRow & { isToday: boolean } => !!row)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const groups: NotificationGroup[] = [
    { heading: "TODAY", rows: rows.filter((row) => row.isToday) },
    { heading: "EARLIER", rows: rows.filter((row) => !row.isToday) },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/** Ids of every unread row — what "Mark all read" fans out over. */
export function selectUnreadIds(data: unknown): string[] {
  return records(data)
    .filter((row) => str(row, "read_at") === null)
    .map((row) => str(row, "id"))
    .filter((id): id is string => !!id);
}
