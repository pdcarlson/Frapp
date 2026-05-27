import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_FREE_TIER_KEY = 'subscription_free_tier';
export const SUBSCRIPTION_EXEMPT_KEY = 'subscription_exempt';

/**
 * Marks a controller or route as free-tier (chat / members / invites wedge).
 * Writes remain allowed when the chapter's subscription is `past_due` or
 * `incomplete`. Reads are unaffected. The `canceled` hard-lock still applies.
 */
export const FreeTier = () => SetMetadata(SUBSCRIPTION_FREE_TIER_KEY, true);

/**
 * Bypasses the subscription guard entirely. Use for billing endpoints that
 * must remain reachable while the chapter is locked so admins can recover.
 */
export const SubscriptionExempt = () =>
  SetMetadata(SUBSCRIPTION_EXEMPT_KEY, true);
