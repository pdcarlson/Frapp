/**
 * The task screen's rules (#5492): what it shows and which controls a viewer
 * gets, kept here where they are unit-tested, so `app/(app)/task-details.tsx`
 * is composition only.
 *
 * Every control follows `task.controller.ts` exactly. Mark done is the
 * assignee's or a `tasks:manage` holder's (`PATCH /v1/tasks/:id/status`);
 * Mark not done only the assignee's, before an officer confirms (an officer
 * moving someone's completion back is Send back, its own endpoint). Edit,
 * Delete and Remove people are `tasks:manage`, and Edit is refused once a
 * task is confirmed. There is no creator rule.
 *
 * A row's long-press menu (#5492) reads the same controls
 * (`taskMenuKeys`), so the menu and the screen can't disagree about who may
 * do what.
 */

import { Alert } from "react-native";

import {
  canReopenOwnTask,
  isTaskStatus,
  TASK_ACTION_LABELS,
  type TaskStatus,
} from "@repo/hooks";
import { formatRelativeDayTime } from "@repo/formatting";
import { taskGroupLabel } from "@repo/validation";
import { records, str } from "@/lib/more/narrow";
import {
  rowSignedOffAutomatically,
  toTaskRow,
  type TaskRowModel,
} from "@/lib/tasks/board";
import { checkboxSequence } from "@/lib/tasks/transitions";
import { markDoneLabel } from "@/lib/tasks/task-photos";

/**
 * Who a group task went to, in the shared words (`taskGroupLabel`):
 * "Everyone", "Everyone in Philanthropy", "6 people". `null` for one
 * person's task.
 */
export function rowGroupLabel(row: TaskRowModel): string | null {
  if (!row.group) return null;
  return taskGroupLabel({
    audience: row.group.audience,
    target_name: row.group.targetName,
    total: row.group.total,
  });
}

/** A row's status as `taskStatusLabel` and the status hue read it. */
export function rowStatus(row: TaskRowModel): {
  status: TaskStatus;
  stored_status?: TaskStatus;
  points_awarded: boolean;
  sent_back_at: string | null;
  point_reward: number | null;
  proof_kind: TaskRowModel["proofKind"];
} {
  const stored = isTaskStatus(row.storedStatus) ? row.storedStatus : undefined;
  return {
    status: isTaskStatus(row.displayStatus)
      ? row.displayStatus
      : (stored ?? "TODO"),
    stored_status: stored,
    points_awarded: row.pointsAwarded,
    sent_back_at: row.sentBackAt,
    point_reward: row.pointReward,
    proof_kind: row.proofKind,
  };
}

export interface TaskScreenControls {
  /** The one thing to do: the accent pill. */
  markDone: boolean;
  edit: boolean;
  /** The minus, on a group task's copy. */
  removePeople: boolean;
  /** In More: Mark not done. */
  reopen: boolean;
  /** In More: Give it back, on a task claimed from Up for grabs. */
  release: boolean;
  /** In More, destructive. */
  delete: boolean;
  /** In More, destructive and last: every copy of a group task. */
  deleteForEveryone: boolean;
  /**
   * The long-press menu's Reassign: an edit opened on Assign to. Not on a
   * group's copy, since a group edit refuses `assignee_id`.
   */
  reassign: boolean;
  /** The long-press menu's Duplicate: New task, filled in from this one. */
  duplicate: boolean;
}

export function taskScreenControls({
  row,
  viewerId,
  canManage,
  toggleRefused,
}: {
  row: TaskRowModel;
  viewerId: string | null;
  /** `tasks:manage`, read with `can`, so an owner's `*` counts. */
  canManage: boolean;
  /** A gate refusal latched on the status write (#2710): no Mark done. */
  toggleRefused: boolean;
}): TaskScreenControls {
  const isAssignee = viewerId !== null && row.assigneeId === viewerId;
  const stored = isTaskStatus(row.storedStatus) ? row.storedStatus : undefined;
  // The board's rule for its sheet's Edit (#4296): the edit form needs an
  // assignee and a day, and a confirmed task can't change.
  const edit =
    canManage &&
    !row.pointsAwarded &&
    row.assigneeId !== null &&
    row.dueDay !== null;
  return {
    // A status this build doesn't know has no sequence to send, so no Mark
    // done that would do nothing (the board's `canToggle` guard).
    markDone:
      !row.isDone &&
      (isAssignee || canManage) &&
      !toggleRefused &&
      checkboxSequence(row).length > 0,
    edit,
    removePeople: canManage && row.groupId !== null,
    reopen:
      !toggleRefused &&
      canReopenOwnTask({
        stored,
        pointsAwarded: row.pointsAwarded,
        isAssignee,
        signedOffAutomatically: rowSignedOffAutomatically(row),
      }),
    // The assignee of a task taken from Up for grabs, until it is done
    // (`POST /v1/tasks/:id/release`).
    release: isAssignee && row.openTaskId !== null && !row.isDone,
    delete: canManage,
    deleteForEveryone: canManage && row.groupId !== null,
    reassign: edit && row.groupId === null,
    // Creating needs `tasks:manage` (`POST /v1/tasks`), nothing more.
    duplicate: canManage,
  };
}

/** A task's long-press menu rows (#5492), in the order they are drawn. */
export type TaskMenuKey =
  | "markDone"
  | "reopen"
  | "edit"
  | "reassign"
  | "removePeople"
  | "duplicate"
  | "delete"
  | "deleteForEveryone";

/**
 * Which rows a task's long-press menu draws: what the task screen offers the
 * same viewer, less Give it back (the screen's, by its More). Mark done is
 * the task screen's pill, so it leads; the two deletes are last, and red.
 *
 * `group`: a Calendar row that stands for every copy of a group task
 * (an officer's "4 of 12 done"), which can only be acted on as a group:
 * Remove people, Duplicate, Delete for everyone.
 */
export function taskMenuKeys(
  controls: TaskScreenControls,
  scope: "copy" | "group" = "copy",
): TaskMenuKey[] {
  const keys: TaskMenuKey[] = [];
  if (scope === "copy") {
    if (controls.markDone) keys.push("markDone");
    if (controls.reopen) keys.push("reopen");
    if (controls.edit) keys.push("edit");
    if (controls.reassign) keys.push("reassign");
  }
  if (controls.removePeople) keys.push("removePeople");
  if (controls.duplicate) keys.push("duplicate");
  if (scope === "copy" && controls.delete) keys.push("delete");
  if (controls.deleteForEveryone) keys.push("deleteForEveryone");
  return keys;
}

/**
 * Delete's question, the platform alert, for the task screen's More and a
 * row's long-press menu alike. One copy's Delete, or, `everyone`, every copy
 * of a group task. `onConfirm` runs on the red button.
 */
export function confirmTaskDelete(
  title: string,
  everyone: boolean,
  onConfirm: () => void,
): void {
  Alert.alert(
    everyone ? `Delete "${title}" for everyone?` : `Delete "${title}"?`,
    everyone
      ? "Every member's copy goes, including ones already marked done. This can't be undone."
      : "This can't be undone.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: everyone ? "Delete for everyone" : "Delete task",
        style: "destructive",
        onPress: onConfirm,
      },
    ],
  );
}

/** One History line: what happened, then when (and why, for a send-back). */
export interface TaskHistoryLine {
  key: "assigned" | "done" | "sent-back" | "confirmed";
  title: string;
  meta: string;
  at: number;
}

/**
 * What happened to the task, oldest first, from its own timestamps: no
 * history endpoint exists, so a step a later one overwrote (a completion an
 * officer sent back, then the next) shows only as it now stands, as
 * Todoist's task page lists the activity it holds.
 */
export function taskHistory(
  row: TaskRowModel,
  nameOf: (userId: string) => string,
  now: Date,
): TaskHistoryLine[] {
  const lines: TaskHistoryLine[] = [];
  const add = (
    key: TaskHistoryLine["key"],
    title: string,
    when: string | null,
    extra?: string | null,
  ) => {
    if (!when) return;
    const at = Date.parse(when);
    const label = formatRelativeDayTime(when, now);
    if (Number.isNaN(at) || !label) return;
    lines.push({
      key,
      title,
      meta: extra ? `${label} · ${extra}` : label,
      at,
    });
  };
  add(
    "assigned",
    row.createdBy ? `Assigned by ${nameOf(row.createdBy)}` : "Assigned",
    row.createdAt,
  );
  // No name: the read has no `completed_by`, and an officer may mark a
  // member's task done for them.
  if (row.isDone) add("done", "Marked done", row.completedAt);
  add("sent-back", "Sent back", row.sentBackAt, row.sentBackReason);
  // A completion that needed no sign-off is confirmed as it is marked done:
  // its one line is Marked done.
  if (row.pointsAwarded && !rowSignedOffAutomatically(row)) {
    add("confirmed", "Confirmed", row.confirmedAt);
  }
  return lines.sort((a, b) => a.at - b.at);
}

/**
 * A group task's copies, one a member, read off the board's query: an
 * officer's `GET /v1/tasks` holds the whole chapter's tasks, so no endpoint
 * of its own is needed. Empty for anyone else, whose read holds only theirs.
 */
export function groupCopies(
  data: unknown,
  groupId: string | null,
): TaskRowModel[] {
  if (!groupId) return [];
  const copies: TaskRowModel[] = [];
  for (const raw of records(data)) {
    if (str(raw, "group_id") !== groupId) continue;
    const row = toTaskRow(raw);
    if (row?.assigneeId) copies.push(row);
  }
  return copies;
}

/** Where a copy stands, for ordering Who has it: what's left leads. */
function copyRank(row: TaskRowModel): number {
  if (row.isOverdue) return 0;
  if (!row.isDone) return 1;
  if (!row.pointsAwarded) return 2;
  return 3;
}

/**
 * Who has it, in order: overdue, still to do, waiting on an officer, then
 * confirmed, by name within each, so the members still to finish lead, as
 * web's Who's left lists them.
 */
export function sortCopies(
  copies: readonly TaskRowModel[],
  nameOf: (userId: string) => string,
): TaskRowModel[] {
  return [...copies].sort(
    (a, b) =>
      copyRank(a) - copyRank(b) ||
      nameOf(a.assigneeId ?? "").localeCompare(nameOf(b.assigneeId ?? "")),
  );
}

/**
 * A copy Remove people may take out: one not yet confirmed. A confirmed copy
 * stays, its points paid on it, and the API refuses it.
 */
export function copyRemovable(copy: TaskRowModel): boolean {
  return !copy.pointsAwarded;
}

/**
 * Whether Remove may go ahead with these picks: at least one, and not every
 * copy, since taking out everyone is Delete for everyone (the API's 400).
 */
export function removalAllowed(
  picked: ReadonlySet<string>,
  copies: readonly TaskRowModel[],
): { ok: boolean; everyone: boolean; count: number } {
  const count = livePicks(picked, copies).size;
  const everyone = copies.length > 0 && count >= copies.length;
  return { ok: count > 0 && !everyone, everyone, count };
}

/**
 * The picks that still name a copy Remove may take out: a refetch can drop a
 * copy (taken out elsewhere) or confirm one meanwhile, and a pick left over
 * from it must not count, or send.
 */
export function livePicks(
  picked: ReadonlySet<string>,
  copies: readonly TaskRowModel[],
): ReadonlySet<string> {
  const removable = new Set(
    copies.filter(copyRemovable).map((copy) => copy.assigneeId),
  );
  return new Set([...picked].filter((userId) => removable.has(userId)));
}

/** "Remove 3", the select mode's one pill. */
export function removeLabel(count: number): string {
  return `Remove ${count}`;
}

/** What the confirm asks, and what is said once it lands. */
export function removeConfirmTitle(count: number): string {
  return count === 1 ? "Take 1 person out?" : `Take ${count} people out?`;
}

export const REMOVE_CONFIRM_BODY =
  "Their copies of this task are deleted. Everyone else keeps theirs.";

export function removedLine(count: number): string {
  // Every pick had left already (taken out from another phone or the web):
  // nothing changed, and saying "0 people" would read as a failure.
  if (count === 0) return "They were already off this task.";
  return count === 1
    ? "Took 1 person out of this task."
    : `Took ${count} people out of this task.`;
}

/** Said in select mode once every copy is picked. */
export const REMOVE_EVERYONE_NOTE =
  "That's everyone. Use Delete for everyone in More instead.";

/**
 * Mark done's words in the bar. With two or more round controls beside it
 * (an officer's Edit, Remove people, More), "Mark done with a photo" would
 * not fit a 320pt phone, so the pill says "Mark done" and the proof it asks
 * for is its spoken hint and the first thing its sheet asks; with one round
 * or none there is room for the whole verb.
 */
export function markDoneBarLabel(
  proofKind: TaskRowModel["proofKind"],
  rounds: number,
): { label: string; hint: string | undefined } {
  const full = markDoneLabel(TASK_ACTION_LABELS.complete, proofKind);
  if (rounds < 2 || full === TASK_ACTION_LABELS.complete) {
    return { label: full, hint: undefined };
  }
  return { label: TASK_ACTION_LABELS.complete, hint: `${full}.` };
}
