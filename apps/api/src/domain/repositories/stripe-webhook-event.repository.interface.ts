export const STRIPE_WEBHOOK_EVENT_REPOSITORY =
  'STRIPE_WEBHOOK_EVENT_REPOSITORY';

/**
 * Result of trying to claim a Stripe event for processing (FRA-23).
 *
 * - `claimed` — this caller owns the event and must process it.
 * - `already_processed` — an earlier delivery completed it; skip silently.
 * - `in_flight` — another worker holds a fresh claim; skip and let it finish.
 */
export type StripeWebhookClaimOutcome =
  | 'claimed'
  | 'already_processed'
  | 'in_flight';

export interface StripeWebhookClaim {
  outcome: StripeWebhookClaimOutcome;
  /** Delivery attempt number for this event id, starting at 1. */
  attempts: number;
}

export interface IStripeWebhookEventRepository {
  /**
   * Atomically claim `eventId` before running its side effects.
   *
   * A row left `processing` for longer than `staleSeconds` is treated as
   * abandoned (the worker died mid-handler) and taken over, so a crash cannot
   * wedge an event permanently.
   */
  claim(
    eventId: string,
    eventType: string,
    staleSeconds: number,
  ): Promise<StripeWebhookClaim>;

  /** Mark a claimed event as fully handled. */
  markProcessed(eventId: string): Promise<void>;

  /** Record a handler failure, leaving the event immediately re-claimable. */
  markFailed(eventId: string, error: string): Promise<void>;
}
