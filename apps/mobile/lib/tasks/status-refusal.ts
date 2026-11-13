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
import {
  TASK_PROOF_REQUIRED_CODE,
  TASK_RESUBMIT_NEEDS_CHANGE_CODE,
  TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE,
} from "@repo/validation";
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

/** The line for a Mark done refused for want of proof. */
export const TASK_PROOF_REFUSAL =
  "This task needs proof to show it's done. Add it, then mark it done.";

/**
 * Was this Mark done refused for want of proof (`TASK_PROOF_REQUIRED_CODE`,
 * #4565) or, on a task an officer sent back, of something new
 * (`TASK_RESUBMIT_NEEDS_CHANGE_CODE`, #4635)? The line to show, or `null` for
 * any other failure. Matched by the code, never the message, as an installed
 * build must be.
 *
 * The phone asks for proof before it sends (`markDoneCheck`), so this is the
 * case where the task changed after it was read (an officer switched it to
 * Photo, or sent it back). The board and the task card then open the Mark
 * done sheet with this line in it, so the member adds what's missing there.
 */
export function taskProofRefusal(error: unknown): string | null {
  if (statusOf(error) !== 400) return null;
  const code = codeOf(error);
  if (code === TASK_PROOF_REQUIRED_CODE) return TASK_PROOF_REFUSAL;
  if (code === TASK_RESUBMIT_NEEDS_CHANGE_CODE) {
    return TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE;
  }
  return null;
}

/**
 * A refused confirm that isn't a gate's, when the server gives no message
 * worth relaying: the task card's line, which Activity's row Confirm also
 * says (#4437).
 */
export const TASK_CONFIRM_FAILURE = "Couldn't confirm the task.";
