import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestResponse, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type {
  IStripeWebhookEventRepository,
  StripeWebhookClaim,
  StripeWebhookClaimOutcome,
} from '../../../domain/repositories/stripe-webhook-event.repository.interface';

/** Row shape returned by the `claim_stripe_webhook_event` RPC. */
interface ClaimRow {
  claim_outcome: StripeWebhookClaimOutcome;
  claim_attempts: number;
}

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
    // `rpc` args/return are not inferred for `FrappSupabaseClient` because
    // generated table Row types do not satisfy PostgREST's schema constraint.
    const { data, error } = (await (this.supabase as SupabaseClient).rpc(
      'claim_stripe_webhook_event',
      {
        p_event_id: eventId,
        p_event_type: eventType,
        p_stale_seconds: staleSeconds,
      },
    )) as PostgrestResponse<ClaimRow>;
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
    const { error } = await this.supabase
      .from('stripe_webhook_events')
      .update({
        status: 'processed',
        processed_at: new Date().toISOString(),
        last_error: null,
      } as never)
      .eq('event_id', eventId);

    if (error) throw error;
  }

  async markFailed(eventId: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .from('stripe_webhook_events')
      .update({
        status: 'failed',
        last_error: message.slice(0, MAX_ERROR_LENGTH),
      } as never)
      .eq('event_id', eventId);

    if (error) throw error;
  }
}
