export interface StripeWebhookEvent {
  event_id: string;
  event_type: string;
  processing_started_at: string | null;
  processed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}
