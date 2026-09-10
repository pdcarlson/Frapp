import type { TaskStatus } from "@repo/hooks";

/**
 * The columns both the board and the chat task card already agree on. A
 * structural type rather than either surface's concrete `Task` / `LiveTask`
 * so the helper cannot grow a dependency on either file.
 */
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
 * `VALID_ASSIGNEE_TRANSITIONS[OVERDUE]` is `[IN_PROGRESS]` — the same move
 * Start makes. The fallback to `status` covers a pre-#1051 API, where an
 * overdue row simply offers nothing rather than guessing.
 */
export function actionStatus(
  task: TaskActionStatusInput,
): TaskStatus | undefined {
  if (task.stored_status === undefined) {
    // Pre-#1051 API. Derivation only ever *produces* `OVERDUE`, so any other
    // rendered value is also the stored one and is safe to act on; `OVERDUE`
    // alone is ambiguous, and returning `undefined` there offers no action —
    // exactly what the board did before the field existed.
    return task.status === "OVERDUE" ? undefined : task.status;
  }
  return task.stored_status === "OVERDUE" ? "TODO" : task.stored_status;
}
