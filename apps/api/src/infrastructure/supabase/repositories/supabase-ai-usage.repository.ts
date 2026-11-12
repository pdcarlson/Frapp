import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import type { AiUsageRecord } from '#domain/adapters/ai-usage-recorder.interface';
import type {
  AiChapterUsageLine,
  AiSpendCap,
  AiSpendCaps,
  AiSpendHoldResult,
  AiSpendSettleResult,
  IAiUsageRepository,
} from '#domain/repositories/ai-usage.repository.interface';

const CAPS: ReadonlySet<string> = new Set<AiSpendCap>([
  'platform_cap',
  'chapter_cap',
  'member_cap',
]);
const SETTLE_RESULTS: ReadonlySet<string> = new Set<AiSpendSettleResult>([
  'settled',
  'inserted',
  'missing',
]);

/**
 * `ai_usage_events` through the service role (#714). Every call is a
 * database function (`20261112130000_ai_usage_ledger.sql`): the hold is
 * checked against the caps and inserted under the same locks, so two calls at
 * once can't both take the last of a cap.
 *
 * Amounts are bigint in the database and numbers here: a cap in micro-USD
 * stays exact below 2^53, which is about nine billion dollars.
 */
@Injectable()
export class SupabaseAiUsageRepository implements IAiUsageRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async reserve(
    call: AiCallDescriptor,
    costMicroUsd: number,
    caps: AiSpendCaps,
    now: Date,
  ): Promise<AiSpendHoldResult> {
    const { data, error } = await this.supabase.rpc('reserve_ai_spend', {
      p_chapter_id: call.chapterId,
      p_user_id: call.actingUserId,
      p_run_id: call.runId ?? null,
      p_task: call.task,
      p_family: call.family,
      p_provider: call.provider,
      p_model: call.model,
      p_prompt_version: call.promptVersion,
      p_reserved_cost_micro_usd: costMicroUsd,
      p_chapter_cap_micro_usd: caps.chapterMonthlyMicroUsd,
      p_member_cap_micro_usd: caps.memberDailyMicroUsd,
      p_platform_cap_micro_usd: caps.platformMonthlyMicroUsd,
      p_now: now.toISOString(),
    });
    if (error) throw new SupabaseQueryError(error);
    const row = (data ?? [])[0];
    if (!row) throw new Error('reserve_ai_spend returned no row');

    if (row.reservation_id) {
      return {
        granted: true,
        reservationId: row.reservation_id,
        platformSpentBeforeMicroUsd: Number(row.platform_spent_before),
        platformSpentAfterMicroUsd: Number(row.platform_spent_after),
      };
    }
    if (row.refused && CAPS.has(row.refused)) {
      return { granted: false, cap: row.refused as AiSpendCap };
    }
    throw new Error('reserve_ai_spend returned neither a hold nor a cap');
  }

  async settle(
    usage: AiUsageRecord,
    billReservation: boolean,
    now: Date,
  ): Promise<AiSpendSettleResult> {
    const { data, error } = await this.supabase.rpc('settle_ai_spend', {
      p_reservation_id: usage.reservationId,
      p_chapter_id: usage.chapterId,
      p_user_id: usage.actingUserId,
      p_run_id: usage.runId ?? null,
      p_task: usage.task,
      p_family: usage.family,
      p_provider: usage.provider,
      p_model: usage.model,
      p_prompt_version: usage.promptVersion,
      p_outcome: usage.outcome,
      p_error_kind: usage.errorKind,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cached_input_tokens: usage.cachedInputTokens,
      p_cost_micro_usd: usage.costMicroUsd,
      p_bill_reservation: billReservation,
      p_latency_ms: Math.max(0, Math.round(usage.latencyMs)),
      p_now: now.toISOString(),
    });
    if (error) throw new SupabaseQueryError(error);
    if (typeof data !== 'string' || !SETTLE_RESULTS.has(data)) {
      throw new Error('settle_ai_spend returned an unknown result');
    }
    return data as AiSpendSettleResult;
  }

  async expireHolds(olderThan: Date): Promise<number> {
    const { data, error } = await this.supabase.rpc('expire_ai_spend_holds', {
      p_older_than: olderThan.toISOString(),
    });
    if (error) throw new SupabaseQueryError(error);
    return Number(data ?? 0);
  }

  async chapterUsage(
    chapterId: string,
    from: Date,
    to: Date,
  ): Promise<AiChapterUsageLine[]> {
    const { data, error } = await this.supabase.rpc('ai_chapter_usage', {
      p_chapter_id: chapterId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map((row) => ({
      task: row.task,
      provider: row.provider,
      model: row.model,
      calls: Number(row.calls),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      costMicroUsd: Number(row.cost_micro_usd),
      estimatedCostMicroUsd: Number(row.estimated_cost_micro_usd),
      unsettledCalls: Number(row.unsettled_calls),
    }));
  }
}
