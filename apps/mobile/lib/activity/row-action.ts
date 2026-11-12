import { errorCopy } from "@repo/hooks/error-copy";
import { isSubscriptionStatus, subscriptionWriteState } from "@repo/validation";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { taskStatusGateRefusal } from "@/lib/tasks/status-refusal";

/**
 * Whether Activity's rows carry their one-press asks (Confirm, Approve;
 * `activityRowAction` in `@repo/hooks`) as buttons (#4437). They are
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

/** A refused confirm, in the task card's words. */
export const TASK_CONFIRM_FALLBACK = "Couldn't confirm the task.";

/** Why a confirm failed, as the task card says it (`useCardWrite`). */
export function taskConfirmFailure(error: unknown): string {
  return (
    taskStatusGateRefusal(error) ?? errorCopy(error, TASK_CONFIRM_FALLBACK)
  );
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
