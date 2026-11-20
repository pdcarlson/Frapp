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
 * task is confirmed. There is no creator rule. Confirm and Send back
 * (`POST /v1/tasks/:id/confirm` and `/reject`, #5513) are a `tasks:manage`
 * holder's. Confirm is on a completion waiting on their sign-off, never
 * their own (`taskAwaitsReview`: the API refuses a self-confirm). Send back
 * is wherever chat's task card offers it (`taskSendBackOpen`, the API's
 * `isReopenable`): any completion not yet paid, or signed off as it was
 * marked; on their own the screen offers Mark not done instead, which does
 * the same for the assignee.
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
  taskAwaitsReview,
  taskCompletedBy,
  taskConfirmLabel,
  taskSendBackOpen,
  type TaskStatus,
} from "@repo/hooks";
import { formatPointsChip, formatRelativeDayTime } from "@repo/formatting";
import {
  TASK_FOLLOWER_COPY,
  TASK_SERIES_SCOPE_COPY,
  taskGroupLabel,
  taskSeriesLive,
  type TaskSeriesLine,
} from "@repo/validation";
import { records, str } from "@/lib/more/narrow";
import { askSeriesScope } from "@/lib/series-scope";
import {
  rowSignedOffAutomatically,
  toTaskRow,
  type TaskRowModel,
} from "@/lib/tasks/board";
import { checkboxSequence } from "@/lib/tasks/transitions";
import { markDoneLabel } from "@/lib/tasks/task-photos";
import { editFactsOfRow, taskEditable } from "@/lib/tasks/task-edit";

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
  /**
   * An officer's sign-off on someone's completion (#5513): the accent pill,
   * where Mark done would be (a done task has no Mark done).
   */
  confirm: boolean;
  /**
   * Confirm in a row's long-press menu, which shows no proof: only on a task
   * that asked for none, the To review row's own rule (#4635), so a photo or
   * link is seen on the screen before it is confirmed.
   */
  confirmInMenu: boolean;
  /** Send back, with a reason (`taskBarLayout` says where it sits). */
  sendBack: boolean;
  edit: boolean;
  /** The minus, on a group task's copy. */
  removePeople: boolean;
  /**
   * In More: Start, the assignee's To do → In progress (#5492), which chat's
   * task card offers and the screen otherwise didn't.
   */
  start: boolean;
  /** In More: Mark not done. */
  reopen: boolean;
  /** In More: Give it back, on a task claimed from Up for grabs. */
  release: boolean;
  /** In More, destructive. */
  delete: boolean;
  /** In More, destructive and last: every copy of a group task. */
  deleteForEveryone: boolean;
  /**
   * The long-press menu's Reassign: the screen's edit, opened on Assign to.
   * On a group's copy too, which hands over that one copy (#5514): the
   * instance edit takes `assignee_id`, though a group edit refuses it.
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
  /**
   * A gate refusal latched on a status or review write (#2710): no Mark
   * done, Confirm or Send back. The routes share the subscription and module
   * gates, so a refusal on one is a refusal on all.
   */
  toggleRefused: boolean;
}): TaskScreenControls {
  const isAssignee = viewerId !== null && row.assigneeId === viewerId;
  const stored = isTaskStatus(row.storedStatus) ? row.storedStatus : undefined;
  const reviewed = {
    assignee_id: row.assigneeId,
    stored_status: stored ?? null,
    points_awarded: row.pointsAwarded,
    completed_at: row.completedAt,
    confirmed_at: row.confirmedAt,
    point_reward: row.pointReward,
    proof_kind: row.proofKind,
  };
  const awaitsReview =
    !toggleRefused && taskAwaitsReview(reviewed, { viewerId, canManage });
  // The screen's edit in place (#5514): a confirmed task can't change, and
  // the fields need an assignee and a day.
  const edit = taskEditable(editFactsOfRow(row), canManage);
  return {
    // A status this build doesn't know has no sequence to send, so no Mark
    // done that would do nothing (the board's `canToggle` guard).
    markDone:
      !row.isDone &&
      (isAssignee || canManage) &&
      !toggleRefused &&
      checkboxSequence(row).length > 0,
    confirm: awaitsReview,
    confirmInMenu: awaitsReview && row.proofKind === "none",
    // Not before the viewer is known: it may be their own.
    sendBack:
      !toggleRefused &&
      canManage &&
      viewerId !== null &&
      !isAssignee &&
      taskSendBackOpen(reviewed),
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
    // The API's assignee transition: their own task, still To do. The
    // stored status, as the card reads it, so an overdue To do starts too.
    start: isAssignee && stored === "TODO" && !toggleRefused,
    // The assignee of a task taken from Up for grabs, until it is done
    // (`POST /v1/tasks/:id/release`).
    release: isAssignee && row.openTaskId !== null && !row.isDone,
    delete: canManage,
    deleteForEveryone: canManage && row.groupId !== null,
    reassign: edit,
    // Creating needs `tasks:manage` (`POST /v1/tasks`), nothing more.
    duplicate: canManage,
  };
}

/** A task's long-press menu rows (#5492), in the order they are drawn. */
export type TaskMenuKey =
  | "markDone"
  | "confirm"
  | "sendBack"
  | "start"
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
 * the task screen's pill, so it leads, or on a completion waiting on the
 * viewer, Confirm (where no proof needs seeing first) then Send back
 * (#5513); the two deletes are last, and red.
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
    if (controls.confirmInMenu) keys.push("confirm");
    if (controls.sendBack) keys.push("sendBack");
    if (controls.start) keys.push("start");
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

/** What a Delete removes: one copy, every copy of a group, or the repeat. */
export type TaskDeleteScope = "instance" | "group" | "series";

/** `useDeleteTask`'s argument for a Delete's answer. */
export function taskDeleteTarget(
  id: string,
  scope: TaskDeleteScope,
): string | { id: string; scope: "group" | "series" } {
  return scope === "instance" ? id : { id, scope };
}

/**
 * Whether an "All upcoming tasks" delete takes this copy with it (#5119):
 * the server ends the series and deletes its open copy only while it is
 * still to come and no one has started it (to do, no proof, no step
 * checked; `spec/behavior/tasks.md` § Repeating tasks). Any other copy stays,
 * so the task screen stays on it. Its answer doesn't say, so this is the
 * same rule read off the row.
 */
export function seriesDeleteTakesCopy(row: TaskRowModel): boolean {
  return (
    row.displayStatus === "TODO" &&
    (row.storedStatus ?? "TODO") === "TODO" &&
    !row.proofLink &&
    !row.photos.some((photo) => photo.kind === "proof") &&
    !row.subtasks.some((subtask) => subtask.done)
  );
}

/** Said on the task screen when the repeat stopped and this copy stayed. */
export const SERIES_STOPPED_LINE =
  "Stopped repeating. This task and any done or overdue ones stay.";

/**
 * Delete's question, the platform alert, for the task screen's More and a
 * row's long-press menu alike. One copy's Delete, or, `everyone`, every copy
 * of a group task. On a copy of a live repeating series (#5119) it asks as
 * web does, "This task only" or "All upcoming tasks", the second stopping
 * the repeat. `onConfirm` runs on the red button, with what to delete
 * (`taskDeleteTarget`).
 */
export function confirmTaskDelete(
  task: { title: string; series: TaskSeriesLine | null },
  everyone: boolean,
  onConfirm: (scope: TaskDeleteScope) => void,
): void {
  const { title } = task;
  if (!everyone && taskSeriesLive(task.series)) {
    void askSeriesScope({
      title: TASK_SERIES_SCOPE_COPY.deleteTitle,
      message: TASK_SERIES_SCOPE_COPY.deleteMessage,
      thisOne: TASK_SERIES_SCOPE_COPY.thisTask,
      allUpcoming: TASK_SERIES_SCOPE_COPY.allUpcoming,
      destructive: true,
    }).then((scope) => {
      if (scope) onConfirm(scope);
    });
    return;
  }
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
        onPress: () => onConfirm(everyone ? "group" : "instance"),
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
  // Who marked it done (#5732): `completed_by`, since an officer may mark a
  // member's task done for them; the assignee on a completion from before
  // the API kept it. "Submitted to Exec board" when a group follows it
  // (#5473), the words web's review header takes
  // (`TASK_FOLLOWER_COPY.submittedTo`).
  if (row.isDone) {
    const doneBy = taskCompletedBy({
      completed_by: row.completedBy,
      assignee_id: row.assigneeId,
    });
    add(
      "done",
      doneBy ? `Marked done by ${nameOf(doneBy)}` : "Marked done",
      row.completedAt,
      row.followedBy
        ? TASK_FOLLOWER_COPY.submittedTo(row.followedByName)
        : null,
    );
  }
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

/**
 * The most round controls the bar holds beside its pill: at 320pt, a fourth
 * leaves the pill no room for its verb.
 */
const BAR_ROUNDS_MAX = 3;

/**
 * Confirm's words in the bar (#5513): the payout named on it, as web's review
 * says it (`taskConfirmLabel`, "Confirm · +10 pts"), beside up to two round
 * controls: shorter than Mark done's longest, it still fits a 320pt phone
 * there. Beside three, `markDoneBarLabel`'s crowded-bar rule: the pill says
 * "Confirm" and the payout is its spoken hint.
 */
export function confirmBarLabel(
  pointReward: number | null,
  rounds: number,
): { label: string; hint: string | undefined } {
  const full = taskConfirmLabel(pointReward);
  if (rounds < BAR_ROUNDS_MAX || full === TASK_ACTION_LABELS.confirm) {
    return { label: full, hint: undefined };
  }
  return {
    label: TASK_ACTION_LABELS.confirm,
    hint: `Awards ${formatPointsChip(pointReward ?? 0)}.`,
  };
}

/** Where the bar's controls sit, for `taskBarLayout`. */
export interface TaskBarLayout {
  /** Send back as a round beside the pill, or as More's first row. */
  sendBackRound: boolean;
  sendBackInMore: boolean;
  /** Edit as a round, or in More, after Send back. */
  editRound: boolean;
  editInMore: boolean;
  /** Whether More is drawn at all. */
  moreShown: boolean;
  /** The rounds beside the pill, More included: the pill's words read it. */
  rounds: number;
}

/**
 * Where the bar puts Send back and Edit (#5513), so the pill keeps room for
 * its words at 320pt.
 *
 * - While Confirm shows, Edit moves into More, as web's review puts Edit
 *   under its ⋯ so nothing competes with the decision (#4693). That leaves
 *   an officer's usual review two rounds, Send back and More, beside
 *   "Confirm · +10 pts".
 * - Send back is a round while the bar holds fewer than three others, else
 *   More's first row. More then holds at most three rows, which Android's
 *   dialog can draw: Send back or Edit with Delete and Delete for everyone.
 */
export function taskBarLayout({
  controls,
  removePeople,
  otherMoreRows,
}: {
  controls: Pick<TaskScreenControls, "confirm" | "sendBack" | "edit">;
  /** Remove people's round is drawn (a group's copy, its copies read). */
  removePeople: boolean;
  /** More's other rows: Start, Mark not done, Give it back, the deletes. */
  otherMoreRows: number;
}): TaskBarLayout {
  const editInMore = controls.edit && controls.confirm;
  const editRound = controls.edit && !controls.confirm;
  const moreRows = otherMoreRows + (editInMore ? 1 : 0);
  const others = [editRound, removePeople, moreRows > 0].filter(Boolean).length;
  const sendBackRound = controls.sendBack && others < BAR_ROUNDS_MAX;
  const sendBackInMore = controls.sendBack && !sendBackRound;
  const moreShown = moreRows > 0 || sendBackInMore;
  return {
    sendBackRound,
    sendBackInMore,
    editRound,
    editInMore,
    moreShown,
    rounds: [sendBackRound, editRound, removePeople, moreShown].filter(Boolean)
      .length,
  };
}
