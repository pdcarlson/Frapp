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
   * Must never throw, but — unlike `capture` — must report delivery: the
   * account-deletion flow gates the irreversible Supabase Auth deletion on a
   * `true` here, because once the auth account is gone the user can never
   * re-trigger the forget. Return `true` only when the provider acknowledged
   * the request (or there is no provider to notify), `false` on any failure.
   */
  forget(distinctId: string): Promise<boolean>;
}
