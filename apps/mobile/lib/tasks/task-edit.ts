import {
  dueEntryFields,
  dueEntryFromTask,
  dueTimePassed,
  splitDueEntry,
} from "@repo/formatting";
import type { TaskEdit } from "@repo/hooks";
import type { TaskProofKind } from "@repo/validation";
import { parsePointReward } from "./create-task";
import { POINTS_MAX, TITLE_MAX_LENGTH } from "./limits";
import type { TaskRowModel } from "./board";

/**
 * The task screen's in-place edit (#5514), kept here where it is unit-tested
 * so `components/tasks/task-edit-form.tsx` is composition only.
 *
 * Each field saves on its own through `PATCH /v1/tasks/:id`, as web's task
 * panel does (`apps/web/components/tasks/task-panel.tsx`): a field sends only
 * itself, and only when it changed. A group task's copy sends
 * `scope: "group"`, so the edit reaches every copy not yet confirmed, and
 * never who it is for or its photos, which change per copy only (the API's
 * 400). A copy of a repeating task saves to that copy alone, as the phone's
 * edit always did; web asks "This task only" or "All upcoming tasks".
 */

/** What one field's change sends, or why it can't. */
export type TaskFieldSave =
  /** Nothing changed: no request, and the field shows the task again. */
  | { kind: "none" }
  | { kind: "save"; body: TaskEdit }
  /** Not sendable as typed: said under the fields, the draft kept. */
  | { kind: "problem"; message: string };

export const TASK_EDIT_COPY = {
  titleTooLong: `Keep the title to ${TITLE_MAX_LENGTH} characters.`,
  points: `Points must be a whole number, up to ${POINTS_MAX.toLocaleString("en-US")}.`,
  timePassed:
    "That time has already passed today. Pick a later time or another day.",
  failed: "Couldn't save the task. Try again.",
  /** Under the fields on a group task's copy. */
  group: "Changes go to every copy not yet confirmed.",
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
  if (title.length > TITLE_MAX_LENGTH) {
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
 * The task's due as the date and time fields open on it: a timed task on
 * the day and time of its `due_at` on this device, as web's edit reads it.
 * `null` for a task with no day, which the fields can't hold.
 */
export function dueDraftOf(row: TaskRowModel): TaskDueDraft | null {
  if (!row.dueDay) return null;
  const { dueDate, dueTime } = splitDueEntry(
    dueEntryFromTask({ due_date: row.dueDay, due_at: row.dueAt }),
  );
  return { date: dueDate, time: dueTime ?? null };
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
 * The reference photos as they should stand, in order: the task's own kept,
 * then any just uploaded. Sent whole, and only when the set changed.
 */
export function photosSave(
  row: TaskRowModel,
  paths: readonly string[],
): TaskFieldSave {
  const stored = referencePhotos(row).map((photo) => photo.storage_path);
  const same =
    paths.length === stored.length &&
    paths.every((path, i) => path === stored[i]);
  if (same) return NONE;
  return { kind: "save", body: { reference_photo_paths: [...paths] } };
}

/** Hand the task to another member: one copy only, never a group's. */
export function assigneeSave(row: TaskRowModel, userId: string): TaskFieldSave {
  if (row.groupId !== null || userId === row.assigneeId) return NONE;
  return { kind: "save", body: { assignee_id: userId } };
}

/**
 * Whether a new assignee starts the task over at To do (the API resets a
 * task past To do), which the screen asks about before it saves.
 */
export function reassignRestarts(row: TaskRowModel): boolean {
  return row.storedStatus !== null && row.storedStatus !== "TODO";
}

/** A group task's copy edits every copy not yet confirmed (`scope`). */
export function scopedEdit(row: TaskRowModel, body: TaskEdit): TaskEdit {
  return row.groupId !== null ? { ...body, scope: "group" } : body;
}

/** The task's reference photos, the ones an edit keeps or removes. */
export function referencePhotos(row: TaskRowModel): TaskRowModel["photos"] {
  return row.photos.filter((photo) => photo.kind === "reference");
}

/**
 * Who the screen may edit in place (#5514): a `tasks:manage` holder, until
 * the task is confirmed (paid, or signed off), with an assignee and a day,
 * which the fields need. The API refuses an edit once confirmed.
 */
export function taskEditable(row: TaskRowModel, canManage: boolean): boolean {
  return (
    canManage &&
    !row.pointsAwarded &&
    row.confirmedAt === null &&
    row.assigneeId !== null &&
    row.dueDay !== null
  );
}
