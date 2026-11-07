import { STATUS_LABELS } from "@repo/validation";
import type { TaskStatus } from "./use-tasks";

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
  reject: "Reject",
} as const;

/**
 * The word a task's status shows, wherever it is drawn.
 *
 * `TASK_STATUS_LABELS` by status, except a confirmed completion: confirming
 * leaves `status` at `COMPLETED` and sets `points_awarded`, so the label alone
 * would go on saying "Waiting on an officer" forever.
 */
export function taskStatusLabel(task: {
  status: TaskStatus;
  points_awarded: boolean;
}): string {
  if (task.status === "COMPLETED" && task.points_awarded) {
    return TASK_CONFIRMED_LABEL;
  }
  return TASK_STATUS_LABELS[task.status];
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
}): boolean {
  return (
    input.isAssignee && input.stored === "COMPLETED" && !input.pointsAwarded
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
  };
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
 * - **A `tasks:manage` holder** confirms or rejects a completion. Not on their
 *   own task: the server refuses self-confirm (#1056), so the assignee gets
 *   Reject only. Once points are awarded, the only control left is the
 *   Confirmed indicator.
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
  if (live.points_awarded) return ["confirmed"];
  return isAssignee ? ["reject"] : ["confirm", "reject"];
}
