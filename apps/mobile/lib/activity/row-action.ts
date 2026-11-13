import { errorCopy } from "@repo/hooks/error-copy";
import { isSubscriptionStatus, subscriptionWriteState } from "@repo/validation";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { checkInFailure } from "@/lib/events/check-in-outcome";
import {
  TASK_CONFIRM_FAILURE,
  taskStatusGateRefusal,
} from "@/lib/tasks/status-refusal";

/** Where a row's one-press write stands (#4437): none yet, sending, or landed. */
export type ActivityRowActionState = "idle" | "busy" | "done";

/**
 * Whether Activity's rows carry their one-press asks (Confirm, Approve,
 * Check in; `activityRowAction` in `@repo/hooks`) as buttons (#4437, #4427). They are
 * paid-chapter writes, so while the chapter's plan refuses them no row draws
 * one and each opens its sheet, whose card puts the refusal into words, as
 * web's rows follow `activityRowActionGate`.
 *
 * Keyed on the plan's own verdict (`subscriptionWriteState`, the guard's
 * order), never on the connection or a chapter still loading: those disable
 * the button rather than take it away. Fails open on a chapter not read yet
 * or a status this client doesn't model, as web's gate does; the server's
 * guard is the enforcement either way. Says nothing about plans itself, so
 * the App Store rule in `lib/subscription-refusal.ts` holds.
 */
export function activityRowActionsAllowed(
  chapter:
    | { subscription_status?: string | null; past_due_since?: string | null }
    | null
    | undefined,
): boolean {
  const status = chapter?.subscription_status;
  if (!isSubscriptionStatus(status)) return true;
  return subscriptionWriteState({
    status,
    pastDueSince: chapter?.past_due_since ?? null,
  }).allowed;
}

/**
 * Why a row's Confirm, Approve or Check in failed (#4437, #4427), in the
 * words its sheet uses: the task card's for a confirm (`useCardWrite` over
 * `taskStatusGateRefusal`), the hours sheet's for an approval, the chat
 * event card's for a check-in (`checkInFailure`). `gate` marks
 * a refusal from the plan or the module gate, which a retry can't win, so
 * the screen withdraws the buttons as the card withdraws its controls.
 */
export function rowActionFailure(
  action: "confirm" | "approve" | "check-in",
  error: unknown,
): { text: string; gate: boolean } {
  const gate =
    subscriptionRefusalOf(error) !== null || moduleRefusalOf(error) !== null;
  return {
    text:
      action === "confirm"
        ? (taskStatusGateRefusal(error) ??
          errorCopy(error, TASK_CONFIRM_FAILURE))
        : action === "check-in"
          ? checkInFailure(error).message
          : hoursReviewFailure(error, "APPROVED"),
    gate,
  };
}

/**
 * Why a service-hours review failed: the two refusals a retry can't win in a
 * member's words, as the phone's other paid-ops writes say them, else the
 * server's message or the review's own fallback. Shared by the Activity
 * sheet's Approve and Reject and the row's Approve, so they read the same.
 */
export function hoursReviewFailure(
  error: unknown,
  status: "APPROVED" | "REJECTED",
): string {
  if (subscriptionRefusalOf(error)) {
    return SUBSCRIPTION_REFUSAL_COPY.serviceReview;
  }
  if (moduleRefusalOf(error)) return MODULE_REFUSAL_COPY.serviceReview;
  return errorCopy(
    error,
    status === "APPROVED"
      ? "Only a pending entry someone else submitted can be approved."
      : "Couldn't reject this entry. Try again in a moment.",
  );
}
