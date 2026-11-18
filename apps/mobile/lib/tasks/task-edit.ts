import { dueEntryFields, dueTimePassed } from "@repo/formatting";
import type { LiveTask, TaskEdit } from "@repo/hooks";
import { TASK_TITLE_MAX_LENGTH, type TaskProofKind } from "@repo/validation";
import { parsePointReward, storedDueOf, TASK_FORM_COPY } from "./create-task";
import type { TaskRowModel } from "./board";

/**
 * The task screen's in-place edit (#5514), kept here where it is unit-tested
 * so `components/tasks/task-edit-form.tsx` is composition only.
 *
 * Each field saves on its own through `PATCH /v1/tasks/:id`, as web's task
 * panel does (`apps/web/components/tasks/task-panel.tsx`): a field sends only
 * itself, and only when it changed. A group task's copy sends
 * `scope: "group"`, so the edit reaches every copy not yet confirmed, except
 * who it is for, which hands over that one copy (no scope, the API's
 * instance edit). Its photos change per copy only, and the screen leaves
 * them out on a group (the API's 400). A copy of a repeating task saves to
 * that copy alone, as the phone's edit always did; web asks "This task only"
 * or "All upcoming tasks".
 */

/** What one field's change sends, or why it can't. */
export type TaskFieldSave =
  /** Nothing changed: no request, and the field shows the task again. */
  | { kind: "none" }
  | { kind: "save"; body: TaskEdit }
  /** Not sendable as typed: said under the fields, the draft kept. */
  | { kind: "problem"; message: string };

export const TASK_EDIT_COPY = {
  titleTooLong: `Keep the title to ${TASK_TITLE_MAX_LENGTH} characters.`,
  ...TASK_FORM_COPY,
  failed: "Couldn't save the task. Try again.",
  /** Under the fields on a group task's copy. */
  group:
    "The title, notes, due and points change every copy not yet confirmed. Who changes this copy only.",
  saving: "Saving…",
} as const;

const NONE: TaskFieldSave = { kind: "none" };

/**
 * The title as typed. An emptied title isn't a change: the field goes back
 * to the task's, as web's panel puts it back.
 */
export function titleSave(row: TaskRowModel, typed: string): TaskFieldSave {
  const title = typed.trim();
  if (!title || title === row.title) return NONE;
  if (title.length > TASK_TITLE_MAX_LENGTH) {
    return { kind: "problem", message: TASK_EDIT_COPY.titleTooLong };
  }
  return { kind: "save", body: { title } };
}

/** The notes as typed; emptied, they are cleared (`null`). */
export function descriptionSave(
  row: TaskRowModel,
  typed: string,
): TaskFieldSave {
  const description = typed.trim() || null;
  if (description === (row.description?.trim() || null)) return NONE;
  return { kind: "save", body: { description } };
}

/** The points as typed on the keypad; emptied, the task pays none. */
export function pointsSave(row: TaskRowModel, typed: string): TaskFieldSave {
  const parsed = parsePointReward(typed);
  if (parsed.kind === "invalid") {
    return { kind: "problem", message: TASK_EDIT_COPY.points };
  }
  const points = parsed.kind === "value" ? parsed.points || null : null;
  if (points === (row.pointReward || null)) return NONE;
  return { kind: "save", body: { point_reward: points } };
}

/** A due as the fields hold it: the device-local day and `HH:MM` or none. */
export interface TaskDueDraft {
  /** `YYYY-MM-DD`, device-local. */
  date: string;
  /** `HH:MM` on the 24-hour clock, or `null` for due by the day. */
  time: string | null;
}

/**
 * The task's due as the date and time fields open on it (`storedDueOf`).
 * `null` for a task with no day, which the fields can't hold.
 */
export function dueDraftOf(row: TaskRowModel): TaskDueDraft | null {
  if (!row.dueDay) return null;
  const { dueDate, dueTime } = storedDueOf({
    dueDay: row.dueDay,
    dueAt: row.dueAt,
  });
  return { date: dueDate, time: dueTime };
}

/**
 * The day and time as a pair, as the API reads them. The task's own due is
 * never refused for having passed (an overdue task's title can still
 * change); a newly picked time that has gone by today is.
 */
export function dueSave(
  row: TaskRowModel,
  next: TaskDueDraft,
  now: Date,
): TaskFieldSave {
  const stored = dueDraftOf(row);
  const kept = stored
    ? { dueDate: stored.date, dueTime: stored.time }
    : undefined;
  if (dueTimePassed({ dueDate: next.date, dueTime: next.time }, now, kept)) {
    return { kind: "problem", message: TASK_EDIT_COPY.timePassed };
  }
  const dueAt = next.time
    ? (dueEntryFields(`${next.date}T${next.time}`).due_at ?? null)
    : null;
  const storedAt = row.dueAt ? new Date(row.dueAt).toISOString() : null;
  // A timed task's day is its time's day: an unchanged `due_at` is an
  // unchanged due, even read on a device whose zone puts it on another day.
  const changed =
    dueAt !== storedAt || (dueAt === null && next.date !== row.dueDay);
  if (!changed) return NONE;
  return { kind: "save", body: { due_date: next.date, due_at: dueAt } };
}

/** What Mark done needs. */
export function proofSave(
  row: TaskRowModel,
  next: TaskProofKind,
): TaskFieldSave {
  if (next === row.proofKind) return NONE;
  return { kind: "save", body: { proof_kind: next } };
}

/**
 * The reference photos as they should stand, in order, against the set as
 * it stands (`stored`): sent whole, and only when it changed.
 */
export function photosSave(
  stored: readonly string[],
  paths: readonly string[],
): TaskFieldSave {
  const same =
    paths.length === stored.length &&
    paths.every((path, i) => path === stored[i]);
  if (same) return NONE;
  return { kind: "save", body: { reference_photo_paths: [...paths] } };
}

/**
 * Hand the task to another member. On a group's copy too: that one copy
 * becomes theirs, sent with no scope (`scopedEdit`).
 */
export function assigneeSave(row: TaskRowModel, userId: string): TaskFieldSave {
  if (userId === row.assigneeId) return NONE;
  return { kind: "save", body: { assignee_id: userId } };
}

/**
 * Whether a new assignee starts the task over at To do (the API resets a
 * task past To do), which the screen asks about before it saves.
 */
export function reassignRestarts(row: TaskRowModel): boolean {
  return row.storedStatus !== null && row.storedStatus !== "TODO";
}

/**
 * A group task's copy edits every copy not yet confirmed (`scope: "group"`),
 * except a new assignee, which hands over this copy alone: a group edit
 * refuses `assignee_id`, and the instance edit takes it.
 */
export function scopedEdit(row: TaskRowModel, body: TaskEdit): TaskEdit {
  if (row.groupId === null || body.assignee_id !== undefined) return body;
  return { ...body, scope: "group" };
}

/**
 * The task as it will read once `body` lands: what a field's next change is
 * measured against while an earlier one of it is on its way, so a change
 * back to what the task said before still sends.
 */
export function rowAfter(row: TaskRowModel, body: TaskEdit): TaskRowModel {
  return {
    ...row,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined
      ? { description: body.description }
      : {}),
    ...(body.point_reward !== undefined
      ? { pointReward: body.point_reward }
      : {}),
    ...(body.due_date !== undefined ? { dueDay: body.due_date } : {}),
    ...(body.due_at !== undefined ? { dueAt: body.due_at } : {}),
    ...(body.proof_kind !== undefined ? { proofKind: body.proof_kind } : {}),
    ...(body.assignee_id !== undefined ? { assigneeId: body.assignee_id } : {}),
  };
}

/** The task's reference photos, the ones an edit keeps or removes. */
export function referencePhotos(row: TaskRowModel): TaskRowModel["photos"] {
  return row.photos.filter((photo) => photo.kind === "reference");
}

/** What decides whether a task can be edited, from a row or a card's read. */
export interface TaskEditFacts {
  pointsAwarded: boolean;
  confirmedAt: string | null;
  assigneeId: string | null;
  /** It has a day, which the due field needs. */
  hasDue: boolean;
}

export function editFactsOfRow(row: TaskRowModel): TaskEditFacts {
  return {
    pointsAwarded: row.pointsAwarded,
    confirmedAt: row.confirmedAt,
    assigneeId: row.assigneeId,
    hasDue: row.dueDay !== null,
  };
}

/** A chat card's live task, as `taskEditable` reads it. */
export function editFactsOfLive(live: LiveTask): TaskEditFacts {
  return {
    pointsAwarded: live.points_awarded,
    confirmedAt: live.confirmed_at,
    assigneeId: live.assignee_id ?? null,
    hasDue: !!live.due,
  };
}

/**
 * Who may edit a task in place (#5514), the task screen's rule and the chat
 * card's Edit gate alike, so the card never opens an edit the screen won't
 * draw: a `tasks:manage` holder, until the task is confirmed (paid, or
 * signed off), with an assignee and a day, which the fields need (a task up
 * for grabs has no assignee yet). The API refuses an edit once confirmed.
 */
export function taskEditable(task: TaskEditFacts, canManage: boolean): boolean {
  return (
    canManage &&
    !task.pointsAwarded &&
    task.confirmedAt === null &&
    task.assigneeId !== null &&
    task.hasDue
  );
}
