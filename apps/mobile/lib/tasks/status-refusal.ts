/**
 * Why a gate refused a task-status write, in the member's words.
 *
 * `PATCH /v1/tasks/:id/status` and the confirm and reject routes sit behind
 * the subscription guard and `@RequireModule('tasks')`. Two surfaces make those
 * writes on mobile, the s08 board's checkbox and the chat task card, and both
 * say why the same way and withdraw their controls, as `writing.md` asks for a
 * gate refusal. One copy, so the two can't drift, as `checkInFailure` does for
 * the two check-in surfaces.
 *
 * Returns `null` for every other failure. What a surface does then differs on
 * purpose: the board reverts quietly and lets the member tap again, and the
 * card relays the server's message.
 */

import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";

export function taskStatusGateRefusal(error: unknown): string | null {
  if (subscriptionRefusalOf(error)) return SUBSCRIPTION_REFUSAL_COPY.taskStatus;
  if (moduleRefusalOf(error)) return MODULE_REFUSAL_COPY.taskStatus;
  return null;
}

/**
 * A refused confirm that isn't a gate's, when the server gives no message
 * worth relaying: the task card's line, which Activity's row Confirm also
 * says (#4437).
 */
export const TASK_CONFIRM_FAILURE = "Couldn't confirm the task.";
