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

import { codeOf, statusOf } from "@repo/api-sdk";
import { TASK_PROOF_REQUIRED_CODE } from "@repo/validation";
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
 * The board's line when Mark done is refused because the task needs a proof
 * photo (`TASK_PROOF_REQUIRED_CODE`, #4565), or `null` for anything else.
 * The phone can't attach one until the second half of #4565 ships, so the
 * line says where it can be done rather than reverting the box in silence.
 * Matched by the code, never the message.
 */
export function taskProofRequiredRefusal(error: unknown): string | null {
  return statusOf(error) === 400 && codeOf(error) === TASK_PROOF_REQUIRED_CODE
    ? "This task needs a photo of the finished job. Add it and mark it done from Frapp on the web."
    : null;
}

/**
 * A refused confirm that isn't a gate's, when the server gives no message
 * worth relaying: the task card's line, which Activity's row Confirm also
 * says (#4437).
 */
export const TASK_CONFIRM_FAILURE = "Couldn't confirm the task.";
