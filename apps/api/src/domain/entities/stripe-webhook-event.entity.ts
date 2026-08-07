/**
 * Durable record of a Stripe webhook delivery (FRA-23).
 *
 * One row per side-effecting Stripe event id, written before the handler runs.
 * This is the process-independent replacement for the old in-memory
 * `processedEventIds` set, which lost every claim on restart.
 */
export type StripeWebhookEventStatus = 'processing' | 'processed' | 'failed';

export interface StripeWebhookEvent {
  /** Stripe's `evt_...` id — the natural key. */
  event_id: string;
  event_type: string;
  status: StripeWebhookEventStatus;
  /** Incremented on every re-claim (failed retry or stale-claim takeover). */
  attempts: number;
  last_error: string | null;
  claimed_at: string;
  processed_at: string | null;
  created_at: string;
}
