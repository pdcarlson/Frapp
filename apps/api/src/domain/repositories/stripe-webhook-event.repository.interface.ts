export const STRIPE_WEBHOOK_EVENT_REPOSITORY =
  'STRIPE_WEBHOOK_EVENT_REPOSITORY';

export type StripeWebhookEventClaimResult =
  | 'claimed'
  | 'processing'
  | 'processed';

export interface IStripeWebhookEventRepository {
  claim(
    eventId: string,
    eventType: string,
  ): Promise<StripeWebhookEventClaimResult>;
  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string, errorMessage: string): Promise<void>;
}
