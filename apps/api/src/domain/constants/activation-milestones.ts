/**
 * The free-to-paid activation funnel (issue #267), in order.
 *
 * One vocabulary serves two consumers deliberately: each string is used
 * verbatim as both the `milestone` value stored in `chapter_activation_
 * milestones` and the analytics event name sent to the provider. A mapping
 * table between the two would be a second thing to keep in sync, and the
 * failure mode of it drifting is a funnel that silently stops matching.
 *
 * Ordering is the funnel's own — index is the step number, so conversion
 * between any two steps is `count(step N+1) / count(step N)`. The steps are
 * *not* strictly sequential for every chapter (a chapter can enable a paid
 * module before anyone redeems an invite), which is precisely what the funnel
 * is for measuring; the order encodes the intended path, not a state machine.
 *
 * Names are kebab-case to match the existing event examples on
 * `AnalyticsEvent` in `@repo/validation` (`opened-channel`,
 * `ran-slash-command`).
 *
 * Only the API records milestones, so this lives here rather than in
 * `@repo/validation` (#3268).
 *
 * Canonical behavior: `spec/behavior/observability.md` (#activation-funnel).
 */
export const ACTIVATION_MILESTONES = [
  /** The onboarding wizard was submitted and the chapter row exists. */
  'activation-onboarding-submitted',
  /** The chapter issued its first invite (link or batch). */
  'activation-first-invite-created',
  /** Someone other than the founder joined by redeeming an invite. */
  'activation-first-invite-redeemed',
  /** The first human-authored message was posted in any channel. */
  'activation-first-chat-message',
  /** A `tier: "paid"` module was switched on for the first time. */
  'activation-first-paid-module-enabled',
  /** A Stripe checkout session was created (intent to pay). */
  'activation-checkout-started',
  /** Stripe confirmed the checkout and the subscription went active. */
  'activation-checkout-completed',
] as const;

export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number];

/** Step number (1-based) of a milestone within the funnel, for ordering. */
export function activationMilestoneStep(
  milestone: ActivationMilestone,
): number {
  return ACTIVATION_MILESTONES.indexOf(milestone) + 1;
}
