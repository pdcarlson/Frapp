/**
 * The task lifecycle ladder, as the *client* is allowed to walk it.
 *
 * Mirrors `VALID_ASSIGNEE_TRANSITIONS` in
 * `apps/api/src/application/services/task.service.ts`, which is the authority.
 * This copy exists only so s08 can stop *offering* a tap it knows will 400; it
 * never grants one — the server re-checks every PATCH and
 * `useUpdateTaskStatus` rolls back on rejection. Same relationship
 * `CHECK_IN_GRACE_MINUTES` has to the attendance service.
 *
 * ## Two facts that shape every caller
 *
 * **There is no `TODO → COMPLETED` edge.** The server's table is
 * `TODO → [IN_PROGRESS]`, `IN_PROGRESS → [COMPLETED]`, `COMPLETED → []`. A
 * checkbox is drawn as a binary control (`canvas-screens.dc.html` s08), but
 * completing a fresh task is genuinely two writes. Any "one tap, one PATCH"
 * implementation collects a guaranteed 400 on every `TODO` row.
 *
 * **The ladder is keyed off `stored_status`, never `status`.** `OVERDUE` is
 * synthesized at read time and collapses `TODO` and `IN_PROGRESS` into one
 * indistinct value, so a client holding only `status` cannot tell which
 * transition is legal — which is precisely why #1051 put `stored_status` on the
 * wire. `useUpdateTaskStatus`'s `onMutate` patches both halves, so the value
 * read here stays correct through an optimistic write.
 */

import {
  actionStatus,
  canReopenOwnTask,
  isTaskStatus,
  type TaskStatus,
} from "@repo/hooks";

/**
 * The full write sequence one tap should send, keyed by the stored status.
 *
 * **Not** a copy of the server's table — `TODO` maps to two writes because the
 * server accepts only `IN_PROGRESS` from `TODO`, and a drawn checkbox means
 * "done". This is the ladder that reaches the drawn outcome through transitions
 * the server will actually take.
 *
 * `OVERDUE` has no rung of its own. The API derives it on read and never
 * writes it, but the column allows it and older rows carry it, and a stored
 * `OVERDUE` takes the `TODO` ladder: the server accepts `OVERDUE →
 * IN_PROGRESS`, the move Start makes. `actionStatus` in `@repo/hooks` maps it,
 * the rule every task surface keys its actions off (`spec/behavior/tasks.md`).
 */
const LADDER: Record<"TODO" | "IN_PROGRESS" | "COMPLETED", TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
};

/**
 * Is this task still owed?
 *
 * The same predicate `selectNextTask` (`components/chat/up-next-strip.tsx`)
 * applies when it picks the UP NEXT row — "`COMPLETED` excluded, `OVERDUE`
 * kept" — stated once here so the strip and the board cannot drift into two
 * definitions of an open task. The strip picks one row and the board renders
 * every row, so they share the rule rather than the selector.
 */
export function isOpenTask(storedStatus: string | null): boolean {
  return storedStatus !== "COMPLETED";
}

/**
 * The PATCH sequence one checkbox tap should send, in order.
 *
 * An empty array means **the row must not be pressable at all** — not that the
 * handler should no-op. A `Pressable` that silently swallows taps reads as
 * broken; the caller drops `onPress` entirely and marks the control disabled.
 *
 * Which rung is `actionStatus`'s answer, so the board and both chat task cards
 * offer the same move on the same row. `displayStatus` is only consulted in
 * the degraded branch: a row with no `stored_status` (a pre-#1051 API) is
 * recoverable when the display value is itself a stored one, and
 * unrecoverable when it is `OVERDUE`. There, offering either transition is a
 * coin flip that 400s half the time, so the row goes inert instead.
 */
export function nextTapSequence(
  storedStatus: string | null,
  displayStatus: string | null,
): TaskStatus[] {
  // A stored value this module doesn't know is not the degraded branch:
  // guessing from the display could offer a write the server refuses.
  if (storedStatus !== null && !isTaskStatus(storedStatus)) return [];
  const stored = storedStatus ?? undefined;
  const status = isTaskStatus(displayStatus) ? displayStatus : stored;
  if (status === undefined) return [];
  const rung = actionStatus({ status, stored_status: stored });
  return rung === undefined || rung === "OVERDUE" ? [] : LADDER[rung];
}

/**
 * What the board's checkbox sends, both ways: the ladder to done on an open
 * task, and back to `IN_PROGRESS` on the viewer's own completion an officer
 * hasn't confirmed (`canReopenOwnTask`), the way a checked reminder unchecks.
 * Empty once confirmed: points have moved, and the server refuses the reopen.
 *
 * Every row on the board is the viewer's own (`selectTaskRows` filters by
 * assignee), so this takes no assignee argument.
 */
export function checkboxSequence(row: {
  storedStatus: string | null;
  displayStatus: string | null;
  pointsAwarded: boolean;
}): TaskStatus[] {
  const stored = isTaskStatus(row.storedStatus) ? row.storedStatus : undefined;
  if (
    canReopenOwnTask({
      stored,
      pointsAwarded: row.pointsAwarded,
      isAssignee: true,
    })
  ) {
    return ["IN_PROGRESS"];
  }
  return nextTapSequence(row.storedStatus, row.displayStatus);
}
