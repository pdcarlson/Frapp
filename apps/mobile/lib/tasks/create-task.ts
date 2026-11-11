import {
  dueEntryFields,
  formatWeekdayDay,
  localIsoDate,
} from "@repo/formatting";

/**
 * Draft state and validation for the s19 "New task" sheet.
 *
 * ## Why the rules live here and not in `@repo/validation`
 *
 * That package carries no task schema — `"task"` appears in it only as a chat
 * message kind and `"tasks"` as a notification category. `CreateTaskDto`
 * (`apps/api/src/interface/dtos/task.dto.ts`) is the authority, and the web task
 * form does not share a schema either. Adding one to a shared package for a
 * single caller would create a second authority to keep in sync; these copies
 * exist only so the sheet can disable its own CTA rather than post a request it
 * knows will 400.
 *
 * ## The due date
 *
 * Any day from today on, picked with the platform's date picker
 * (`components/tasks/due-date-field.tsx`, #3597), or with a preset chip.
 * A picked day is held as a date, like "Friday" ({@link resolveDue}).
 */

import { TASK_SUBTASKS_MAX } from "@repo/validation";
import { POINTS_MAX, TITLE_MAX_LENGTH } from "./limits";

export interface NewTaskDraft {
  title: string;
  /** `YYYY-MM-DD`, device-local. */
  dueDate: string;
  /**
   * `HH:MM` on the 24-hour clock, device-local, when the task is due at a
   * time of day (#4003); `null` or absent for a task due by the day.
   */
  dueTime?: string | null;
  /** The steps, in order (#4003); blank lines are dropped on send. */
  subtasks?: string[];
  assigneeId: string | null;
  /** Raw keypad text, so a half-typed value is not silently coerced. */
  pointsInput: string;
}

export interface DuePreset {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, device-local. */
  date: string;
  /**
   * How a draft kept past the day it was picked reads this chip. "Today" and
   * "Tomorrow" are relative: they mean the day the task is filed and the day
   * after. "Friday" and "Next week" name a date, and the draft keeps that
   * date ({@link resolveDue}).
   */
  relative: boolean;
}

/**
 * `now` plus `days` (negative for days before), as a local date. Counted in
 * calendar days rather than by adding 24 hours, so a daylight-saving change
 * can't skip or repeat a day. Month and year rollover is `Date`'s job.
 */
export function addDays(now: Date, days: number): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The four due-date choices the sheet offers.
 *
 * "Friday" is dropped on Thursday and on Friday itself, where it would
 * duplicate "Tomorrow" or "Today": the row shows three chips then rather than
 * two with one date. From Saturday it is the next week's Friday. No two chips
 * ever share a date (today, +1, Friday at +2 to +6, +7), which
 * {@link resolveDue} relies on.
 */
export function duePresets(now: Date): DuePreset[] {
  const presets: DuePreset[] = [
    { id: "today", label: "Today", date: localIsoDate(now), relative: true },
    {
      id: "tomorrow",
      label: "Tomorrow",
      date: localIsoDate(addDays(now, 1)),
      relative: true,
    },
  ];

  // 5 = Friday. `getDay()` is Sunday-indexed.
  const daysToFriday = (5 - now.getDay() + 7) % 7;
  if (daysToFriday > 1) {
    presets.push({
      id: "friday",
      label: "Friday",
      date: localIsoDate(addDays(now, daysToFriday)),
      relative: false,
    });
  }

  presets.push({
    id: "next-week",
    label: "Next week",
    date: localIsoDate(addDays(now, 7)),
    relative: false,
  });

  return presets;
}

/**
 * A due chip as a draft holds it: a relative chip by its id, re-read against
 * the day the task is filed, or the date a dated chip named when it was
 * picked (see {@link DuePreset.relative}).
 */
export type DueChoice =
  { kind: "relative"; id: string } | { kind: "date"; date: string };

/** A new draft's due choice: "Today". */
export const DEFAULT_DUE_CHOICE: DueChoice = { kind: "relative", id: "today" };

/** What a draft holds once the member picks `preset`. */
export function dueChoiceOf(preset: DuePreset): DueChoice {
  return preset.relative
    ? { kind: "relative", id: preset.id }
    : { kind: "date", date: preset.date };
}

export interface ResolvedDue {
  /** `YYYY-MM-DD`, device-local: the date Create sends. */
  date: string;
  /** The chip `now`'s presets draw for `date`, or `null` when none does. */
  chipId: string | null;
}

/**
 * A held due choice, read on the day `now` falls on.
 *
 * A relative chip is that chip's date today. A held date stays as picked, and
 * the chip shown selected is whichever of today's resolves to it: a "Friday"
 * picked on Wednesday is the Tomorrow chip on Thursday, and a "Next week"
 * kept a day matches no chip at all. A held date that has passed falls back to
 * Today: a chip never files a task already overdue.
 */
export function resolveDue(choice: DueChoice, now: Date): ResolvedDue {
  const presets = duePresets(now);
  const today = localIsoDate(now);
  const held =
    choice.kind === "relative"
      ? presets.find((preset) => preset.id === choice.id)?.date
      : choice.date;
  // `YYYY-MM-DD` orders as a string.
  const date = held !== undefined && held >= today ? held : today;
  const chip = presets.find((preset) => preset.date === date);
  return { date, chipId: chip?.id ?? null };
}

/**
 * The drawn date-field label — "Fri, Aug 21".
 *
 * Parsed at local noon so a bare `YYYY-MM-DD` renders as its own day in every
 * zone, the same fix `lib/more/service-hours.ts` documents.
 */
export function formatDueFieldLabel(
  isoDate: string,
  now: Date = new Date(),
): string {
  // The shared house shape: the year shows on a date in another one (#3928),
  // since the picker reaches any day and "Sun, Mar 14" a year out would read
  // as this year's.
  return formatWeekdayDay(isoDate, now) ?? isoDate;
}

/**
 * The keypad's text as a point reward.
 *
 * Three outcomes, not two: `"omit"` for a blank field (the reward is optional
 * and the drawn LATER row carries no chip), a value, or `"invalid"`. Collapsing
 * blank into invalid would leave the CTA disabled on the common case of not
 * offering points at all.
 */
export type PointsParse =
  { kind: "omit" } | { kind: "value"; points: number } | { kind: "invalid" };

export function parsePointReward(value: string): PointsParse {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "omit" };
  if (!/^\d{1,6}$/.test(trimmed)) return { kind: "invalid" };
  const points = Number(trimmed);
  if (!Number.isInteger(points) || points < 0 || points > POINTS_MAX) {
    return { kind: "invalid" };
  }
  return { kind: "value", points };
}

export interface ValidatedNewTask {
  title: string;
  assignee_id: string;
  due_date: string;
  /** The moment it is due, when the draft has a time. */
  due_at?: string;
  /** Subtask titles, in order, when the draft has any. */
  subtasks?: string[];
  point_reward?: number;
}

/**
 * The time field's text: `"5 PM"`, `"9:30 AM"`. The minutes only when there
 * are some, as a calendar writes a time.
 */
export function formatDueTimeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const period = hours < 12 ? "AM" : "PM";
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${hour} ${period}`
    : `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Where "Add a time" starts: 5 PM, the end of a chapter's working day, or
 * for a task due today once that has passed, the next whole hour (up to
 * 11 PM), so a fresh time is never already behind.
 */
export function suggestedDueTime(dueDate: string, now: Date): string {
  if (dueDate !== localIsoDate(now) || now.getHours() < 17) return "17:00";
  return `${String(Math.min(now.getHours() + 1, 23)).padStart(2, "0")}:00`;
}

/**
 * True when the draft names a time on today that has already gone by: a
 * task created like that would be overdue the moment it exists.
 */
export function dueTimePassed(
  draft: Pick<NewTaskDraft, "dueDate" | "dueTime">,
  now: Date,
  /**
   * An edit's due as the task already has it (#4296). A task that is
   * overdue can still have its title or points changed, so its own due
   * isn't refused for having passed; only a newly picked one is.
   */
  kept?: Pick<NewTaskDraft, "dueDate" | "dueTime">,
): boolean {
  if (!draft.dueTime) return false;
  if (
    kept &&
    kept.dueDate === draft.dueDate &&
    (kept.dueTime ?? null) === draft.dueTime
  ) {
    return false;
  }
  const { due_at } = dueEntryFields(`${draft.dueDate}T${draft.dueTime}`);
  return due_at !== undefined && Date.parse(due_at) <= now.getTime();
}

/**
 * The draft as a request body, or `null` while it is not yet postable.
 *
 * Mirrors `CreateTaskDto`: title non-empty and ≤ 255, `assignee_id` a member id,
 * `due_date` a `YYYY-MM-DD`, `point_reward` an optional integer in
 * `0 … POINTS_ADJUSTMENT_MAX`. The assignee comes from the roster picker, so
 * only its presence is checked here — the server re-validates chapter
 * membership regardless.
 */
export function validateNewTask(
  draft: NewTaskDraft,
  now: Date = new Date(),
  /** An edit's stored due, which may have passed (see `dueTimePassed`). */
  kept?: Pick<NewTaskDraft, "dueDate" | "dueTime">,
): ValidatedNewTask | null {
  const title = draft.title.trim();
  if (title.length === 0 || title.length > TITLE_MAX_LENGTH) return null;
  if (!draft.assigneeId) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return null;
  if (draft.dueTime && !/^\d{2}:\d{2}$/.test(draft.dueTime)) return null;
  if (dueTimePassed(draft, now, kept)) return null;

  const points = parsePointReward(draft.pointsInput);
  if (points.kind === "invalid") return null;

  const body: ValidatedNewTask = {
    title,
    assignee_id: draft.assigneeId,
    due_date: draft.dueDate,
  };
  if (draft.dueTime) {
    const { due_at } = dueEntryFields(`${draft.dueDate}T${draft.dueTime}`);
    if (due_at) body.due_at = due_at;
  }
  const subtasks = (draft.subtasks ?? [])
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .slice(0, TASK_SUBTASKS_MAX);
  if (subtasks.length > 0) body.subtasks = subtasks;
  if (points.kind === "value") body.point_reward = points.points;
  return body;
}

/** A task as an edit opens it (#4296): what the sheet's fields start from. */
export interface TaskEditTarget {
  id: string;
  title: string;
  assigneeId: string;
  /** The stored `due_date`. */
  dueDay: string;
  /** The stored `due_at`, or `null` for a task due by the day. */
  dueAt: string | null;
  pointReward: number | null;
  /** The stored status: a new assignee starts anything past To do over. */
  storedStatus: string | null;
}

/**
 * The sheet's draft for a task as it stands. A timed task opens on the day
 * and time of its `due_at` on this device, the inverse of `dueEntryFields`.
 */
export function editDraftOf(task: TaskEditTarget): NewTaskDraft {
  const at = task.dueAt ? new Date(task.dueAt) : null;
  const timed = at !== null && !Number.isNaN(at.getTime());
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    title: task.title,
    dueDate: timed ? localIsoDate(at) : task.dueDay,
    dueTime: timed ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : null,
    subtasks: [],
    assigneeId: task.assigneeId,
    pointsInput: task.pointReward ? String(task.pointReward) : "",
  };
}

/** What `PATCH /v1/tasks/:id` takes (#4296). */
export interface TaskEditBody {
  title?: string;
  assignee_id?: string;
  due_date?: string;
  due_at?: string | null;
  point_reward?: number | null;
}

/**
 * Only what the officer changed, the due date and time as a pair, as the
 * API reads them. Empty when nothing changed, so Save sends nothing.
 */
export function taskEditBody(
  task: TaskEditTarget,
  next: ValidatedNewTask,
): TaskEditBody {
  const body: TaskEditBody = {};
  if (next.title !== task.title) body.title = next.title;
  if (next.assignee_id !== task.assigneeId) {
    body.assignee_id = next.assignee_id;
  }
  const dueAt = next.due_at ?? null;
  const storedAt = task.dueAt ? new Date(task.dueAt).toISOString() : null;
  // A timed task's day is its time's day: an unchanged `due_at` is an
  // unchanged due, even read on a device whose zone puts it on another day.
  const dueChanged =
    dueAt !== storedAt || (dueAt === null && next.due_date !== task.dueDay);
  if (dueChanged) {
    body.due_date = next.due_date;
    body.due_at = dueAt;
  }
  const points = next.point_reward || null;
  if (points !== (task.pointReward || null)) body.point_reward = points;
  return body;
}
