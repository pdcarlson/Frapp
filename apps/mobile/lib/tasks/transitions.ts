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

import type { TaskStatus } from "@repo/hooks";

/**
 * The statuses the server will accept a transition *from*, keyed by the stored
 * value. `OVERDUE` is deliberately absent: it is never persisted
 * (`toDisplayStatus` synthesizes it and `task.entity.ts` never stores it), so
 * the API's own `OVERDUE` row is unreachable and reproducing it here would
 * imply a state this module can observe.
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
 * `displayStatus` is only consulted in the degraded branch. A payload carrying
 * no `stored_status` (the chat `kind:"task"` card ships bare `status`) is
 * recoverable when the display value is itself a stored one, and unrecoverable
 * when it is `OVERDUE` — there, offering either transition is a coin flip that
 * 400s half the time, so the row goes inert instead.
 */
export function nextTapSequence(
  storedStatus: string | null,
  displayStatus: string | null,
): TaskStatus[] {
  const stored = storedStatus ?? displayStatus;
  if (stored === "TODO" || stored === "IN_PROGRESS" || stored === "COMPLETED") {
    return LADDER[stored];
  }
  return [];
}
