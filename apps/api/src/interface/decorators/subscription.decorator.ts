import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_FREE_TIER_KEY = 'subscription_free_tier';
export const SUBSCRIPTION_EXEMPT_KEY = 'subscription_exempt';
export const SUBSCRIPTION_GRACE_BLOCKED_KEY = 'subscription_grace_blocked';

/**
 * Marks a controller or route as free-tier (the chat / members / invites
 * wedge, though ten controllers carry this today). Reads are unaffected.
 *
 * Under `active` every write passes before this marker is even read, so it
 * only matters once a chapter lapses. And "free-tier" does NOT mean "always
 * allowed": it buys writes under `incomplete`, and under `past_due` *within*
 * the 3-day grace window. After grace every write, free-tier included, throws
 * `write_locked`, and the `canceled` hard-lock always applies. A route
 * additionally marked `@GraceBlocked()` is blocked on `past_due` even inside
 * grace.
 */
export const FreeTier = () => SetMetadata(SUBSCRIPTION_FREE_TIER_KEY, true);

/**
 * Bypasses the subscription guard entirely — the only marker that survives the
 * `canceled` hard lock, so it is the strongest thing here and the shortest list.
 *
 * Two kinds of route qualify, and the second is not billing:
 *
 * - **Billing recovery** — the endpoints an admin needs to pay a locked chapter
 *   back into `active` (`BillingController`, and `POST
 *   /v1/invoices/:id/payment-intent`, since dues collection is itself the
 *   recovery path).
 * - **Member safety** — reporting objectionable content and blocking an abusive
 *   member (`ChatReportController`, `ChatBlockController`, #2257). App Store
 *   Guideline 1.2 expects a UGC app to offer both, and it has no billing
 *   exception: a member being harassed in a chapter whose card failed needs
 *   them exactly as much as one in a paying chapter. `@FreeTier()` is not
 *   enough — it lapses with the `past_due` grace window and never applies under
 *   `canceled`.
 *
 * Nothing else. A route that is merely important is not exempt; the bar is that
 * refusing it while a chapter is locked would be either unrecoverable or unsafe.
 * `subscription.decorator.spec.ts` pins both the class-level and the
 * route-level rosters.
 */
export const SubscriptionExempt = () =>
  SetMetadata(SUBSCRIPTION_EXEMPT_KEY, true);

/**
 * Marks a free-tier route (e.g. invite/create) that must STILL be blocked
 * during the `past_due` grace window. Per spec, invites are part of the free
 * wedge while `incomplete` but are blocked once a paying chapter lapses to
 * `past_due`. Has no effect outside the `past_due` grace branch, so the
 * `incomplete` wedge keeps working. After grace the hard lock blocks it anyway.
 */
export const GraceBlocked = () =>
  SetMetadata(SUBSCRIPTION_GRACE_BLOCKED_KEY, true);
