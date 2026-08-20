import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesUpdate } from '../database.types';
import type {
  IStripeWebhookEventRepository,
  StripeWebhookClaim,
} from '../../../domain/repositories/stripe-webhook-event.repository.interface';

/** Postgres caps nothing here, but an unbounded provider message is not worth storing. */
const MAX_ERROR_LENGTH = 1000;

@Injectable()
export class SupabaseStripeWebhookEventRepository implements IStripeWebhookEventRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async claim(
    eventId: string,
    eventType: string,
    staleSeconds: number,
  ): Promise<StripeWebhookClaim> {
    const { data, error } = await this.supabase.rpc(
      'claim_stripe_webhook_event',
      {
        p_event_id: eventId,
        p_event_type: eventType,
        p_stale_seconds: staleSeconds,
      },
    );
    if (error) throw error;

    const row = (data ?? [])[0];
    if (!row) {
      // The function always returns exactly one row. No row means the call did
      // not really succeed, and processing unclaimed would defeat the point.
      throw new Error(
        `claim_stripe_webhook_event returned no row for event ${eventId}`,
      );
    }

    return { outcome: row.claim_outcome, attempts: row.claim_attempts };
  }

  async markProcessed(eventId: string): Promise<void> {
    const patch: TablesUpdate<'stripe_webhook_events'> = {
      status: 'processed',
      processed_at: new Date().toISOString(),
      last_error: null,
    };
    const { error } = await this.supabase
      .from('stripe_webhook_events')
      .update(patch)
      .eq('event_id', eventId);

    if (error) throw error;
  }

  async markFailed(eventId: string, message: string): Promise<void> {
    const patch: TablesUpdate<'stripe_webhook_events'> = {
      status: 'failed',
      last_error: message.slice(0, MAX_ERROR_LENGTH),
    };
    const { error } = await this.supabase
      .from('stripe_webhook_events')
      .update(patch)
      .eq('event_id', eventId);

    if (error) throw error;
  }
}
