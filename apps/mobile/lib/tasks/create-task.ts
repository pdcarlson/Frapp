import {
  dueEntryFields,
  dueEntryFromTask,
  dueTimePassed,
  formatWeekdayDay,
  localIsoDate,
  splitDueEntry,
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

import type { CreateOpenTaskBody, useCreateTask } from "@repo/hooks";
import {
  TASK_AUDIENCE_COPY,
  TASK_SUBTASKS_MAX,
  TASK_TITLE_MAX_LENGTH,
  normalizeTaskWho,
  taskWhoRequest,
  type TaskProofKind,
  type TaskWho,
} from "@repo/validation";
import { POINTS_MAX } from "./limits";
import type { TaskRowModel } from "./board";

/**
 * What the task forms say about a value they can't send: the New task sheet
 * and the task screen's edit alike (#5514).
 */
export const TASK_FORM_COPY = {
  points: `Points must be a whole number, up to ${POINTS_MAX.toLocaleString("en-US")}.`,
  timePassed:
    "That time has already passed today. Pick a later time or another day.",
} as const;

/**
 * A task's stored due (`due_date`, and `due_at` when it has a time) as the
 * forms hold it: the day and `HH:MM` of its `due_at` on this device, or the
 * stored day with no time. The inverse of `dueEntryFields`, read alike by
 * New task's suggestion and Duplicate and the task screen's edit.
 */
export function storedDueOf(due: { dueDay: string; dueAt: string | null }): {
  dueDate: string;
  dueTime: string | null;
} {
  const { dueDate, dueTime } = splitDueEntry(
    dueEntryFromTask({ due_date: due.dueDay, due_at: due.dueAt }),
  );
  return { dueDate, dueTime: dueTime ?? null };
}

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
  /**
   * Who it is for (2026-11-18): one person, a copy each for several people,
   * a role, a group or the chapter, or one task up for grabs among them.
   * `null` while nobody is picked.
   */
  who: TaskWho | null;
  /** Raw keypad text, so a half-typed value is not silently coerced. */
  pointsInput: string;
  /** What Mark done needs (#4635); absent reads as None. */
  proofKind?: TaskProofKind;
  /**
   * The officer's notes, sent as they are. The form has no field for them;
   * only a Duplicate carries the original's over (#5492).
   */
  description?: string | null;
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
  /**
   * Who it is for, never nobody. {@link createRequestOf} turns it into the
   * create: a task, a copy each, or one task up for grabs.
   */
  who: TaskWho;
  due_date: string;
  /** The moment it is due, when the draft has a time. */
  due_at?: string;
  /** Subtask titles, in order, when the draft has any. */
  subtasks?: string[];
  point_reward?: number;
  /** What Mark done needs, when it is more than None (#4635). */
  proof_kind?: TaskProofKind;
  /** The notes a Duplicate carries over (#5492). */
  description?: string;
  /**
   * Reference photos' storage paths, in order (#4635): added by the sheet
   * once the picked photos are up, never by {@link validateNewTask}.
   */
  reference_photo_paths?: string[];
  /**
   * Repeat on this rule (#5119), the task its series' first copy: added by
   * the sheet from its Repeat control, never by {@link validateNewTask}. One
   * person's task only; the API refuses it on a group or up for grabs.
   */
  recurrence_rule?: string;
  /**
   * The tier, role or group it is from (#5473): added by the sheet from its
   * From field, never by {@link validateNewTask}. Not on a task up for grabs
   * (once claimed it is the claimer's own) nor a repeating one, which the
   * API refuses.
   */
  followed_by?: string;
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
): ValidatedNewTask | null {
  const title = draft.title.trim();
  if (title.length === 0 || title.length > TASK_TITLE_MAX_LENGTH) return null;
  const who = draft.who ? normalizeTaskWho(draft.who) : null;
  if (!who) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return null;
  if (draft.dueTime && !/^\d{2}:\d{2}$/.test(draft.dueTime)) return null;
  if (dueTimePassed(draft, now)) return null;

  const points = parsePointReward(draft.pointsInput);
  if (points.kind === "invalid") return null;

  const body: ValidatedNewTask = { title, who, due_date: draft.dueDate };
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
  if (draft.proofKind && draft.proofKind !== "none") {
    body.proof_kind = draft.proofKind;
  }
  const description = draft.description?.trim();
  if (description) body.description = description;
  return body;
}

/**
 * What New task opens on for a Duplicate (#5492): the task's words, points,
 * proof, steps and who, as a new task, as Things 3's and Todoist's Duplicate
 * copy an item. Not its photos, which would have to go up again, nor anything
 * that happened to it (done, sent back, confirmed).
 */
export interface TaskPrefill {
  title: string;
  description: string | null;
  who: TaskWho | null;
  pointsInput: string;
  proofKind: TaskProofKind;
  subtasks: string[];
  /** Its own day while that is still ahead, else New task's default. */
  due: DueChoice;
  dueTime: string | null;
  /** The tier, role or group it is from (#5473), or `null`. */
  followedBy: string | null;
}

/**
 * Who a Duplicate goes to: the same person, or the group a copy was one of,
 * named as its read names it (the chapter, a tier, a role, a chapter group); people
 * picked one by one are its copies' assignees. `null`, for the officer to
 * pick, when a group's members can't be read off `copies`.
 */
export function duplicateWho(
  row: TaskRowModel,
  copies: readonly TaskRowModel[],
): TaskWho | null {
  const group = row.group;
  if (!row.groupId || !group) {
    return row.assigneeId ? { kind: "person", userId: row.assigneeId } : null;
  }
  if (group.audience === "everyone") {
    return { kind: "each", target: { kind: "chapter" } };
  }
  if (
    (group.audience === "role" ||
      group.audience === "group" ||
      group.audience === "tier") &&
    group.targetId
  ) {
    return {
      kind: "each",
      target: { kind: group.audience, id: group.targetId },
    };
  }
  const userIds = [
    ...new Set(
      copies.flatMap((copy) => (copy.assigneeId ? [copy.assigneeId] : [])),
    ),
  ];
  return userIds.length > 0
    ? { kind: "each", target: { kind: "people", userIds } }
    : null;
}

export function taskDuplicateOf(
  row: TaskRowModel,
  copies: readonly TaskRowModel[],
  now: Date,
): TaskPrefill {
  const { dueDate, dueTime } = row.dueDay
    ? storedDueOf({ dueDay: row.dueDay, dueAt: row.dueAt })
    : { dueDate: "", dueTime: null };
  // A day that has gone would only be refused; New task's Today stands in.
  const ahead = dueDate !== "" && dueDate >= localIsoDate(now);
  // So would a time that has gone (due today at 9, duplicated at noon): the
  // day stays and the time goes, so the form opens ready to create.
  const time =
    ahead && dueTime && !dueTimePassed({ dueDate, dueTime }, now)
      ? dueTime
      : null;
  return {
    title: row.title,
    description: row.description,
    who: duplicateWho(row, copies),
    pointsInput: row.pointReward ? String(row.pointReward) : "",
    proofKind: row.proofKind,
    subtasks: row.subtasks.map((subtask) => subtask.title),
    due: ahead ? { kind: "date", date: dueDate } : DEFAULT_DUE_CHOICE,
    dueTime: time,
    followedBy: row.followedBy,
  };
}

/**
 * What a create from this sheet says it did. Someone else's task is on no
 * board the creator sees, so it names where it went. The quick actions' +
 * and the task board's own + both say it.
 */
export function taskCreatedLine(
  assigneeName: string | null,
  wasSelf: boolean,
  /** It went on Up for grabs for someone to claim. */
  upForGrabs = false,
): string {
  if (upForGrabs) return `Posted to ${TASK_AUDIENCE_COPY.upForGrabs}.`;
  return wasSelf
    ? "Added to your tasks."
    : `Assigned to ${assigneeName ?? "your chapter member"}.`;
}

/** What `useCreateTask` sends. */
export type CreateTaskBody = Parameters<
  ReturnType<typeof useCreateTask>["mutate"]
>[0];

/**
 * The create a validated form makes (`taskWhoRequest`): `POST /v1/tasks` for
 * one person or a copy each, `POST /v1/open-tasks` for one task up for grabs,
 * which carries no photos and no From.
 */
export type TaskCreateRequest =
  | { route: "task"; body: CreateTaskBody }
  | { route: "open"; body: CreateOpenTaskBody };

export function createRequestOf(task: ValidatedNewTask): TaskCreateRequest {
  const { who, reference_photo_paths, recurrence_rule, followed_by, ...fields } =
    task;
  const request = taskWhoRequest(who);
  if (!request) {
    // `validateNewTask` never lets nobody through.
    throw new Error("A task needs someone to do it.");
  }
  if (request.endpoint === "/v1/open-tasks") {
    return { route: "open", body: { ...fields, ...request.fields } };
  }
  return {
    route: "task",
    body: {
      ...fields,
      ...request.fields,
      ...(reference_photo_paths ? { reference_photo_paths } : {}),
      ...(recurrence_rule ? { recurrence_rule } : {}),
      ...(followed_by && !recurrence_rule ? { followed_by } : {}),
    },
  };
}

/**
 * Whether a who may carry reference photos: one person only. A copy each
 * can't yet (`TASK_AUDIENCE_COPY.noPhotos`), and a task up for grabs takes
 * none.
 */
export function whoTakesPhotos(who: TaskWho | null): boolean {
  return !who || who.kind === "person";
}
