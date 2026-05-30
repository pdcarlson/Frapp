import type { AnalyticsEvent } from '@repo/validation';

export const ANALYTICS_PROVIDER = 'ANALYTICS_PROVIDER';

/**
 * Transport to the product-analytics provider (PostHog or equivalent). Receives
 * already-pseudonymous events — the `distinctId` on an {@link AnalyticsEvent}
 * is the HMAC hash, never a raw user id. Implementations must not add any
 * identifying property of their own.
 */
export interface IAnalyticsProvider {
  /** Send a single behavioral event. Best-effort; must never throw. */
  capture(event: AnalyticsEvent): Promise<void>;

  /**
   * Add a pseudonymous id to the provider's "deleted users" list, triggering a
   * delete-all-events workflow for that hash (account-deletion propagation).
   * Best-effort; must never throw.
   */
  forget(distinctId: string): Promise<void>;
}
