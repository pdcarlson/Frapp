import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesUpdate } from '../database.types';
import type {
  PredictionAnswer,
  PredictionMarket,
  PredictionMarketStatus,
  PredictionQuestion,
  PredictionStake,
} from '#domain/entities/prediction.entity';
import {
  PREDICTION_REFUSAL_CODES,
  PredictionRefusal,
  type CreatePredictionMarketInput,
  type IPredictionRepository,
  type PlaceStakeInput,
  type PredictionRefusalCode,
} from '#domain/repositories/prediction.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/** A raised exception from plpgsql arrives as P0001 with the code as message. */
const RAISE_EXCEPTION = 'P0001';

function refusalOrQueryError(error: {
  code?: string;
  message?: string;
}): Error {
  const message = error.message ?? '';
  if (
    error.code === RAISE_EXCEPTION &&
    (PREDICTION_REFUSAL_CODES as readonly string[]).includes(message)
  ) {
    return new PredictionRefusal(message as PredictionRefusalCode);
  }
  return new SupabaseQueryError(error);
}

@Injectable()
export class SupabasePredictionRepository implements IPredictionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findMarket(
    chapterId: string,
    marketId: string,
  ): Promise<PredictionMarket | null> {
    const { data, error } = await this.supabase
      .from('prediction_markets')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('id', marketId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findMarketByClientMessageId(
    chapterId: string,
    clientMessageId: string,
  ): Promise<PredictionMarket | null> {
    const { data, error } = await this.supabase
      .from('prediction_markets')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('client_message_id', clientMessageId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async listMarkets(
    chapterId: string,
    options: {
      statuses?: PredictionMarketStatus[];
      ids?: string[];
      createdBy?: string;
      limit: number;
    },
  ): Promise<PredictionMarket[]> {
    if (options.ids && options.ids.length === 0) return [];
    let q = this.supabase
      .from('prediction_markets')
      .select('*')
      .eq('chapter_id', chapterId);
    if (options.statuses?.length) q = q.in('status', options.statuses);
    if (options.ids) q = q.in('id', options.ids);
    if (options.createdBy) q = q.eq('created_by', options.createdBy);
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(options.limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async listAnswers(
    chapterId: string,
    marketIds: string[],
  ): Promise<PredictionAnswer[]> {
    if (marketIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('prediction_answers')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('market_id', marketIds)
      .order('position', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async listStakes(
    chapterId: string,
    marketIds: string[],
  ): Promise<PredictionStake[]> {
    if (marketIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('prediction_stakes')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('market_id', marketIds)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async listMarketIdsStakedBy(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('prediction_stakes')
      .select('market_id')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
    return [...new Set((data ?? []).map((r) => r.market_id))];
  }

  async listOpenQuestions(
    chapterId: string,
    marketIds: string[],
  ): Promise<PredictionQuestion[]> {
    if (marketIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('prediction_questions')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('market_id', marketIds)
      .is('resolved_at', null)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findStakeByClientMessageId(
    chapterId: string,
    clientMessageId: string,
  ): Promise<PredictionStake | null> {
    const { data, error } = await this.supabase
      .from('prediction_stakes')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('client_message_id', clientMessageId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteAwaitingConsent(
    chapterId: string,
    marketId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('prediction_markets')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('id', marketId)
      .eq('status', 'awaiting_consent')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async createMarket(
    input: CreatePredictionMarketInput,
    answers: string[],
  ): Promise<PredictionMarket> {
    const { data: market, error } = await this.supabase
      .from('prediction_markets')
      .insert(input)
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);

    const { error: answersError } = await this.supabase
      .from('prediction_answers')
      .insert(
        answers.map((label, position) => ({
          market_id: market.id,
          chapter_id: input.chapter_id,
          label,
          position,
        })),
      );
    if (answersError) {
      // Two writes, not one: take the market back out rather than leave one
      // with no answers. No stake can exist yet, so nothing else references it.
      await this.supabase
        .from('prediction_markets')
        .delete()
        .eq('chapter_id', input.chapter_id)
        .eq('id', market.id);
      throw new SupabaseQueryError(answersError);
    }
    return market;
  }

  async updateMarketStatus(
    chapterId: string,
    marketId: string,
    fromStatuses: PredictionMarketStatus[],
    patch: TablesUpdate<'prediction_markets'>,
  ): Promise<PredictionMarket | null> {
    const { data, error } = await this.supabase
      .from('prediction_markets')
      .update(patch)
      .eq('chapter_id', chapterId)
      .eq('id', marketId)
      .in('status', fromStatuses)
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async addQuestion(
    chapterId: string,
    marketId: string,
    userId: string,
    note: string,
  ): Promise<PredictionQuestion> {
    const { data, error } = await this.supabase
      .from('prediction_questions')
      .insert({
        chapter_id: chapterId,
        market_id: marketId,
        user_id: userId,
        note,
      })
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  // Cross-chapter by design: the payout sweep serves every chapter, and
  // each market it returns is then paid within its own chapter_id.
  async listPayable(now: string, limit: number): Promise<PredictionMarket[]> {
    const { data, error } = await this.supabase
      .from('prediction_markets')
      .select('*')
      .eq('status', 'settled')
      .lte('question_window_ends_at', now)
      .order('question_window_ends_at', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async placeStake(input: PlaceStakeInput): Promise<PredictionStake> {
    const { data, error } = await this.supabase.rpc('place_prediction_stake', {
      p_chapter_id: input.chapterId,
      p_market_id: input.marketId,
      p_answer_id: input.answerId,
      p_user_id: input.userId,
      p_amount: input.amount,
      p_client_message_id: input.clientMessageId,
      p_since: input.since,
      p_max_stake: input.maxStake,
    });
    if (error) throw refusalOrQueryError(error);
    return data;
  }

  async pay(
    chapterId: string,
    marketId: string,
    answerId: string | null,
    options: { unquestionedOnly?: boolean } = {},
  ): Promise<PredictionMarket> {
    const { data, error } = await this.supabase.rpc('pay_prediction_market', {
      p_chapter_id: chapterId,
      p_market_id: marketId,
      p_answer_id: answerId,
      p_unquestioned_only: options.unquestionedOnly ?? false,
    });
    if (error) throw refusalOrQueryError(error);
    return data;
  }

  async void(
    chapterId: string,
    marketId: string,
    by: string,
    options: { beforePayoutOnly?: boolean } = {},
  ): Promise<PredictionMarket> {
    const { data, error } = await this.supabase.rpc('void_prediction_market', {
      p_chapter_id: chapterId,
      p_market_id: marketId,
      p_by: by,
      p_before_payout_only: options.beforePayoutOnly ?? false,
    });
    if (error) throw refusalOrQueryError(error);
    return data;
  }
}
