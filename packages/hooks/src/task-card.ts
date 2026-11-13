import { formatDueLabel, formatDueOn, isDueOverdue } from "@repo/formatting";
import {
  STATUS_LABELS,
  taskNeedsSignOff,
  type TaskProofKind,
} from "@repo/validation";
import type { TaskStatus, TaskSubtask } from "./use-tasks";

/**
 * The task rules a chat task card applies, shared by web's
 * (`apps/web/components/chat/renderers/task-card.tsx`) and mobile's
 * (`apps/mobile/components/chat/task-card.tsx`). `spec/behavior/tasks.md`
 * § Chat Integration asks for one behaviour on every surface rather than a copy
 * each, and the rules below are the parts that are easy to get subtly wrong:
 * which status an action keys off (#1051), when no action is safe yet (#2065),
 * and who may confirm (#1056). Pure, so both renderers' specs can drive them.
 */

/**
 * The member-facing word for each status, on every task surface: the web
 * board's columns, the mobile board's rows and detail sheet, and both chat
 * cards. One table, so a task never reads one way on web and another on mobile.
 *
 * `COMPLETED` is the assignee's half of the job, not the end of it: an officer
 * still has to confirm before points move. It says who the task is waiting on,
 * so a member doesn't read it as settled while the officer reads it as theirs
 * to act on. "Done" alone was what mobile said, and it meant the opposite of
 * web's "Awaiting confirmation" to the member reading it.
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> =
  STATUS_LABELS.task;

/** The word for a completion an officer has confirmed. */
export const TASK_CONFIRMED_LABEL = "Confirmed";

/**
 * The word for a completion that needed no sign-off (#4635, decision C): no
 * points and no proof, so it is Done when marked done.
 */
export const TASK_DONE_LABEL = "Done";

/**
 * The word for a task an officer sent back (#4635): stored `IN_PROGRESS`
 * with `sent_back_at` set. Worked out on read, never stored as a status, so it
 * sits beside `TASK_STATUS_LABELS` rather than in it.
 */
export const TASK_NEEDS_CHANGES_LABEL = "Needs changes";

/**
 * The verbs every task surface puts on its controls, so web's buttons, the
 * mobile sheet and both chat cards name each move the same way.
 */
export const TASK_ACTION_LABELS = {
  start: "Start",
  complete: "Mark done",
  /** The assignee taking back their own "done" before an officer confirms it. */
  reopen: "Mark not done",
  confirm: "Confirm",
  confirmed: TASK_CONFIRMED_LABEL,
  /** An officer returning a completion to its assignee with a reason. */
  reject: "Send back",
} as const;

/**
 * The word a task's status shows, wherever it is drawn.
 *
 * `TASK_STATUS_LABELS` by status, except:
 * - a confirmed completion: confirming leaves `status` at `COMPLETED` and
 *   sets `points_awarded`, so the label alone would go on saying "Waiting on
 *   an officer" forever. It reads Confirmed, or Done when it needed no
 *   sign-off (#4635; only when the caller passes `proof_kind`, since without
 *   it there is no telling).
 * - a task an officer sent back reads Needs changes (#4635) until it is
 *   marked done again.
 */
export function taskStatusLabel(task: {
  status: TaskStatus;
  points_awarded: boolean;
  stored_status?: TaskStatus;
  sent_back_at?: string | null;
  point_reward?: number | null;
  proof_kind?: TaskProofKind | null;
}): string {
  if (task.status === "COMPLETED" && task.points_awarded) {
    return task.proof_kind != null && !taskNeedsSignOff(task)
      ? TASK_DONE_LABEL
      : TASK_CONFIRMED_LABEL;
  }
  if (isSentBack(task)) return TASK_NEEDS_CHANGES_LABEL;
  return TASK_STATUS_LABELS[task.status];
}

/**
 * Whether an officer sent the task back and it waits on its assignee again
 * (#4635): stored `IN_PROGRESS` with `sent_back_at` set. An overdue one still
 * counts, since the reason is what the assignee needs to see.
 */
export function isSentBack(task: {
  status: TaskStatus;
  stored_status?: TaskStatus;
  sent_back_at?: string | null;
}): boolean {
  return (
    !!task.sent_back_at && (task.stored_status ?? task.status) === "IN_PROGRESS"
  );
}

/**
 * Whether the assignee can take back their own "done": the task is completed
 * and no officer has confirmed it. The server allows `COMPLETED → IN_PROGRESS`
 * for the assignee only in that window (`task.service.ts`), as a
 * compare-and-set against a confirm, so this is the client's offer, never the
 * grant.
 */
export function canReopenOwnTask(input: {
  stored: TaskStatus | undefined;
  pointsAwarded: boolean;
  isAssignee: boolean;
  /**
   * `false` for a task that needed no sign-off (#4635): it was confirmed as
   * it was marked done with nothing paid, so it can still be taken back.
   * Omitted reads as needing one.
   */
  needsSignOff?: boolean;
}): boolean {
  return (
    input.isAssignee &&
    input.stored === "COMPLETED" &&
    (!input.pointsAwarded || input.needsSignOff === false)
  );
}

/** The task as `GET /v1/tasks/{id}` returns it, as much as a card reads. */
export interface LiveTask {
  id: string;
  /** Display status: `OVERDUE` when derived. Drives the badge. */
  status: TaskStatus;
  /**
   * The persisted status (#1051), which drives the actions. `undefined` from a
   * pre-#1051 API, deliberately not defaulted, so a caller can tell "unknown"
   * from a real value.
   */
  stored_status: TaskStatus | undefined;
  points_awarded: boolean;
  /**
   * Whom the task is assigned to now. An officer's edit can hand it to
   * someone else after the card was posted (#4296), so the card's controls
   * follow this, not the snapshot's assignee.
   */
  assignee_id: string | undefined;
  /** Whether each subtask is done, in order (#4003); empty for none. */
  subtasks: { done_at: string | null }[];
  /**
   * When the task is due now: its `due_at` when it has a time of day, else
   * its `due_date`. An edit can move it after a card was posted, so a card's
   * countdown reads this rather than the snapshot's date (#4135).
   */
  due: string | undefined;
  point_reward: number | null;
  /** What Mark done needs (#4635). */
  proof_kind: TaskProofKind;
  /** The assignee's link proof, while the completion stands. */
  proof_link: string | null;
  /** When an officer last sent it back, and why (#4635). */
  sent_back_at: string | null;
  sent_back_reason: string | null;
  /** The assignee's reply sent with Mark done. */
  completion_note: string | null;
  /**
   * Task photos (#4635): reference photos, then proof photos, each in
   * order. Read each through `useTaskPhotoUrl`.
   */
  photos: LiveTaskPhoto[];
}

/** One task photo as a card reads it. */
export interface LiveTaskPhoto {
  id: string;
  kind: "reference" | "proof";
  storage_path: string;
}

/**
 * A task's due line, worded the same on every task surface of both apps
 * (#4133, #4135): the countdown (`"Due tomorrow"`, `"Overdue by 2 days"`,
 * `"Due today at 5 PM"`) while it means something, red only once the task is
 * overdue (Shawn's pick, #4133). A finished task past its date reads the plain
 * `"Due Sep 3"`, never as a charge against handed-in work, and a task whose
 * status the viewer can't read gets the plain date too, since its countdown
 * might not be true. `null` for a missing or unreadable date.
 */
export function taskDueLine(
  due: string | null | undefined,
  status: TaskStatus | null | undefined,
  now: Date = new Date(),
): { text: string; overdue: boolean } | null {
  if (!due) return null;
  if (!status) {
    const on = formatDueOn(due, now);
    return on ? { text: on, overdue: false } : null;
  }
  const label = formatDueLabel(due, now);
  if (!label) return null;
  const pastDue = isDueOverdue(due, now);
  if (status === "COMPLETED") {
    if (!pastDue) return { text: label, overdue: false };
    const on = formatDueOn(due, now);
    return on ? { text: on, overdue: false } : null;
  }
  return { text: label, overdue: pastDue || status === "OVERDUE" };
}

/**
 * Whether a value off the wire is a status the clients know.
 *
 * Read against `TASK_STATUS_LABELS`, whose `Record<TaskStatus, …>` type makes
 * the compiler list every member, so a status added to the union can't be left
 * out of the guard. Shared so the s08 board (`apps/mobile/lib/tasks/
 * transitions.ts`) and both chat cards reject the same unknown values.
 */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TASK_STATUS_LABELS, value)
  );
}

/**
 * `useTask`'s data as a `LiveTask`, or `null` when there is none yet (loading,
 * a 403 or 404, or a shape without an id or a known status).
 */
export function readLiveTask(data: unknown): LiveTask | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== "string" || !isTaskStatus(r.status)) return null;
  return {
    id: r.id,
    status: r.status,
    stored_status: isTaskStatus(r.stored_status) ? r.stored_status : undefined,
    points_awarded: r.points_awarded === true,
    assignee_id: typeof r.assignee_id === "string" ? r.assignee_id : undefined,
    subtasks: Array.isArray(r.subtasks)
      ? r.subtasks
          .filter(
            (row): row is Record<string, unknown> =>
              !!row && typeof row === "object",
          )
          .map((row) => ({
            done_at: typeof row.done_at === "string" ? row.done_at : null,
          }))
      : [],
    due:
      typeof r.due_at === "string" && r.due_at !== ""
        ? r.due_at
        : typeof r.due_date === "string" && r.due_date !== ""
          ? r.due_date
          : undefined,
    point_reward: typeof r.point_reward === "number" ? r.point_reward : null,
    proof_kind:
      r.proof_kind === "photo" || r.proof_kind === "link"
        ? r.proof_kind
        : "none",
    proof_link: nonEmptyString(r.proof_link),
    sent_back_at: nonEmptyString(r.sent_back_at),
    sent_back_reason: nonEmptyString(r.sent_back_reason),
    completion_note: nonEmptyString(r.completion_note),
    photos: readLiveTaskPhotos(r.photos),
  };
}

/** A task's `photos` off the wire, dropping any row without its fields. */
export function readLiveTaskPhotos(value: unknown): LiveTaskPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.storage_path !== "string" ||
      (r.kind !== "reference" && r.kind !== "proof")
    ) {
      return [];
    }
    return [{ id: r.id, kind: r.kind, storage_path: r.storage_path }];
  });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The columns a task row and a chat task card both carry. */
export type TaskActionStatusInput = {
  status: TaskStatus;
  stored_status?: TaskStatus;
};

/**
 * Which status a row's *actions* are decided by.
 *
 * Not `status`: that is the rendered value, and `OVERDUE` renders identically
 * for a stored `TODO` and a stored `IN_PROGRESS` while the server checks its
 * transition table against the stored one (#1051). Columns and badges keep
 * using `status`; only affordances come through here, so the two authorities
 * never get mixed on one row.
 *
 * A row whose *persisted* status is `OVERDUE` maps to `TODO`, because
 * `VALID_ASSIGNEE_TRANSITIONS[OVERDUE]` is `[IN_PROGRESS]`, the same move
 * Start makes. The fallback to `status` covers a pre-#1051 API, where an
 * overdue row simply offers nothing rather than guessing.
 */
export function actionStatus(
  task: TaskActionStatusInput,
): TaskStatus | undefined {
  if (task.stored_status === undefined) {
    // Pre-#1051 API. Derivation only ever *produces* `OVERDUE`, so any other
    // rendered value is also the stored one and is safe to act on; `OVERDUE`
    // alone is ambiguous, and returning `undefined` there offers no action.
    return task.status === "OVERDUE" ? undefined : task.status;
  }
  return task.stored_status === "OVERDUE" ? "TODO" : task.stored_status;
}

/**
 * One control on a task card, in the order the card draws them. `confirmed` is
 * a disabled indicator, not an action: an admin sees that the completion was
 * confirmed, and the card never shows a live Confirm for it twice.
 */
export type TaskCardControl =
  "start" | "complete" | "confirm" | "confirmed" | "reject";

/**
 * Whether the viewer may read the card's task at all. `GET /v1/tasks/{id}`
 * answers only the assignee and a `tasks:manage` holder; anyone else gets a
 * 403, so a card shouldn't ask for them and shows no live status instead.
 */
export function canReadCardTask(input: {
  isAssignee: boolean;
  canManage: boolean;
}): boolean {
  return input.isAssignee || input.canManage;
}

/**
 * The controls a task card offers this viewer.
 *
 * - **Nothing until the live task is read** (#2065). The payload's status is
 *   the creation-time `TODO` forever, so acting on it would offer Start on a
 *   task that is already in progress or done, and the server would refuse it.
 * - **The assignee** walks `TODO → IN_PROGRESS → COMPLETED`, keyed off the
 *   stored status (`actionStatus`).
 * - **A `tasks:manage` holder** confirms or sends back a completion. Not on
 *   their own task: the server refuses self-confirm (#1056), so the assignee
 *   gets Send back only. Once points are awarded, the only control left is
 *   the Confirmed indicator, except on a task that needed no sign-off
 *   (#4635): it is Done with nothing to confirm, and Send back stays.
 */
export function taskCardControls(input: {
  live: LiveTask | null;
  isAssignee: boolean;
  canManage: boolean;
}): TaskCardControl[] {
  const { live, isAssignee, canManage } = input;
  if (!live) return [];
  const stored = actionStatus(live);
  if (isAssignee && stored === "TODO") return ["start"];
  if (isAssignee && stored === "IN_PROGRESS") return ["complete"];
  if (stored !== "COMPLETED" || !canManage) return [];
  if (!taskNeedsSignOff(live)) return ["reject"];
  if (live.points_awarded) return ["confirmed"];
  return isAssignee ? ["reject"] : ["confirm", "reject"];
}

/**
 * Whether the viewer is a task card's assignee, for its controls: the live
 * task's assignee once it is read, since an edit may have reassigned it
 * (#4296), else the snapshot's. A missing viewer matches no one.
 */
export function viewerIsCardAssignee(
  viewerId: string | null | undefined,
  snapshotAssigneeId: string | null | undefined,
  live: Pick<LiveTask, "assignee_id"> | null,
): boolean {
  if (!viewerId) return false;
  return viewerId === (live?.assignee_id ?? snapshotAssigneeId);
}

/**
 * Whether a task card offers its viewer Edit (#4512): a `tasks:manage`
 * holder, once the live task is read, until the task is confirmed. The same
 * rule as the Tasks board's Edit (#4296): a confirmed task's points were paid
 * on it as it stood, so it has none. The card is how Activity and chat show a
 * task, so this is what puts Edit wherever a task is shown.
 */
export function canEditCardTask(input: {
  live: LiveTask | null;
  canManage: boolean;
}): boolean {
  return input.canManage && !!input.live && !input.live.points_awarded;
}

/** A task as an edit form opens it: the fields it shows and compares. */
export interface EditableCardTask {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  due_date: string;
  due_at: string | null;
  point_reward: number | null;
  status: TaskStatus;
  stored_status: TaskStatus | undefined;
  subtasks: TaskSubtask[];
  /** Its reference photos, in order (#4635). */
  reference_photos: LiveTaskPhoto[];
  proof_kind: TaskProofKind;
}

/**
 * `useTask`'s data as what an edit form opens on, or `null` while it can't
 * be edited from (not read yet, or missing a field the form needs).
 */
export function readEditableCardTask(data: unknown): EditableCardTask | null {
  const live = readLiveTask(data);
  if (!live) return null;
  const r = data as Record<string, unknown>;
  if (
    typeof r.title !== "string" ||
    typeof r.assignee_id !== "string" ||
    r.assignee_id === "" ||
    typeof r.due_date !== "string" ||
    r.due_date === ""
  ) {
    return null;
  }
  return {
    id: live.id,
    title: r.title,
    description: typeof r.description === "string" ? r.description : null,
    assignee_id: r.assignee_id,
    due_date: r.due_date,
    due_at: typeof r.due_at === "string" && r.due_at !== "" ? r.due_at : null,
    point_reward: typeof r.point_reward === "number" ? r.point_reward : null,
    status: live.status,
    stored_status: live.stored_status,
    subtasks: Array.isArray(r.subtasks) ? (r.subtasks as TaskSubtask[]) : [],
    reference_photos: live.photos.filter((photo) => photo.kind === "reference"),
    proof_kind: live.proof_kind,
  };
}
