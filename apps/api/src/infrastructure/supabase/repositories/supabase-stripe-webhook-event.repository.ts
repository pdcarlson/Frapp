import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  IStripeWebhookEventRepository,
  type StripeWebhookEventClaimResult,
} from '../../../domain/repositories/stripe-webhook-event.repository.interface';
import type { StripeWebhookEvent } from '../../../domain/entities/stripe-webhook-event.entity';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';

const STALE_PROCESSING_MS = 10 * 60 * 1000;
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
  ): Promise<StripeWebhookEventClaimResult> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('stripe_webhook_events').insert({
      event_id: eventId,
      event_type: eventType,
      processing_started_at: now,
      attempts: 1,
    } as never);

    if (!error) {
      return 'claimed';
    }

    if (!this.isUniqueViolation(error)) {
      throw error;
    }

    const { data: existingData, error: findError } = await this.supabase
      .from('stripe_webhook_events')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();
    if (findError) throw findError;

    const existing = existingData as StripeWebhookEvent | null;
    if (!existing) {
      throw error;
    }

    if (existing.processed_at) {
      return 'processed';
    }

    if (this.isProcessingFresh(existing.processing_started_at)) {
      return 'processing';
    }

    const staleCutoff = new Date(
      Date.now() - STALE_PROCESSING_MS,
    ).toISOString();
    const { data: claimed, error: claimError } = await this.supabase
      .from('stripe_webhook_events')
      .update({
        event_type: eventType,
        processing_started_at: now,
        failed_at: null,
        last_error: null,
        attempts: (existing.attempts ?? 0) + 1,
        updated_at: now,
      } as never)
      .eq('event_id', eventId)
      .is('processed_at', null)
      .or(
        `processing_started_at.is.null,processing_started_at.lt.${staleCutoff}`,
      )
      .select('*')
      .maybeSingle();
    if (claimError) throw claimError;

    return claimed ? 'claimed' : 'processing';
  }

  async markProcessed(eventId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('stripe_webhook_events')
      .update({
        processed_at: now,
        processing_started_at: null,
        failed_at: null,
        last_error: null,
        updated_at: now,
      } as never)
      .eq('event_id', eventId);
    if (error) throw error;
  }

  async markFailed(eventId: string, errorMessage: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('stripe_webhook_events')
      .update({
        processing_started_at: null,
        failed_at: now,
        last_error: errorMessage.slice(0, MAX_ERROR_LENGTH),
        updated_at: now,
      } as never)
      .eq('event_id', eventId);
    if (error) throw error;
  }

  private isProcessingFresh(startedAt: string | null): boolean {
    if (!startedAt) return false;
    return Date.now() - new Date(startedAt).getTime() < STALE_PROCESSING_MS;
  }

  private isUniqueViolation(error: PostgrestError): boolean {
    return error.code === '23505';
  }
}
