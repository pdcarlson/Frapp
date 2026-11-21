import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  AskFeedbackRow,
  AskTraceRow,
  AskTraceStepRow,
} from '#domain/entities/ask-trace.entity';
import type {
  AskTraceSummary,
  IAskTraceRepository,
} from '#domain/repositories/ask-trace.repository.interface';

/** Postgres `unique_violation`: this ask already has a trace. */
const UNIQUE_VIOLATION = '23505';
/** Postgres `foreign_key_violation`: the member, or the trace, is gone. */
const FOREIGN_KEY_VIOLATION = '23503';

const SUMMARY_SELECT = 'id, door, prompt_version, model, effort, outcome';
const FEEDBACK_SELECT =
  'ask_id, chapter_id, user_id, rating, reason, created_at, updated_at';

/**
 * `ai_ask_traces`, `ai_ask_trace_steps` and `ai_ask_feedback` through the
 * service role (#4902, `20261113203728_ai_ask_traces_and_feedback.sql`).
 *
 * Reads and writes are keyed by chapter and asker. Two deletes are not, on
 * purpose: a person's answer on the AI sheet covers every chapter, so a No
 * deletes their traces everywhere (`deleteByUser`), and the sweep deletes
 * whatever has run out wherever it is (`deleteExpired`). Steps and thumbs go
 * with their trace by a cascade, so "the trace is gone" is one statement.
 */
@Injectable()
export class SupabaseAskTraceRepository implements IAskTraceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async insertTrace(
    trace: AskTraceRow,
    steps: readonly AskTraceStepRow[],
  ): Promise<boolean> {
    const { error } = await this.supabase.from('ai_ask_traces').insert(trace);
    if (error) {
      if (
        error.code === UNIQUE_VIOLATION ||
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        return false;
      }
      throw new SupabaseQueryError(error);
    }
    if (steps.length === 0) return true;
    const { error: stepsError } = await this.supabase
      .from('ai_ask_trace_steps')
      .insert([...steps]);
    if (stepsError) {
      // The trace went (a No, a sweep) between the two inserts.
      if (stepsError.code === FOREIGN_KEY_VIOLATION) return false;
      // A turn with its steps missing would read as one that used no
      // tools. Keep neither.
      const { error: cleanupError } = await this.supabase
        .from('ai_ask_traces')
        .delete()
        .eq('id', trace.id)
        .eq('chapter_id', trace.chapter_id);
      // The trace is still there without its steps: say that, not the
      // error that led here.
      if (cleanupError) throw new SupabaseQueryError(cleanupError);
      throw new SupabaseQueryError(stepsError);
    }
    return true;
  }

  async lastStartedAt(
    chapterId: string,
    userId: string,
    before: Date,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('ai_ask_traces')
      .select('started_at')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .lt('started_at', before.toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data?.started_at ?? null;
  }

  async findForAsker(
    askId: string,
    chapterId: string,
    userId: string,
  ): Promise<AskTraceSummary | null> {
    const { data, error } = await this.supabase
      .from('ai_ask_traces')
      .select(SUMMARY_SELECT)
      .eq('id', askId)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async findFeedback(
    askId: string,
    chapterId: string,
    userId: string,
  ): Promise<Pick<AskFeedbackRow, 'rating' | 'reason'> | null> {
    const { data, error } = await this.supabase
      .from('ai_ask_feedback')
      .select('rating, reason')
      .eq('ask_id', askId)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async upsertFeedback(input: {
    askId: string;
    chapterId: string;
    userId: string;
    rating: string;
    reason: string | null;
    now: Date;
  }): Promise<AskFeedbackRow | null> {
    const { data, error } = await this.supabase
      .from('ai_ask_feedback')
      // `created_at` is left to its default, so changing a thumbs keeps the
      // time of the first one.
      .upsert(
        {
          ask_id: input.askId,
          user_id: input.userId,
          rating: input.rating,
          reason: input.reason,
          updated_at: input.now.toISOString(),
          chapter_id: input.chapterId,
        },
        { onConflict: 'ask_id' },
      )
      .select(FEEDBACK_SELECT)
      .single();
    if (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data;
  }

  async deleteFeedback(
    askId: string,
    chapterId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_ask_feedback')
      .delete()
      .eq('ask_id', askId)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .select('ask_id');
    if (error) throw new SupabaseQueryError(error);
    return (data?.length ?? 0) > 0;
  }

  async deleteTrace(askId: string, chapterId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_ask_traces')
      .delete()
      .eq('id', askId)
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data?.length ?? 0) > 0;
  }

  async deleteByUser(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_ask_traces')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async deleteExpired(now: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_ask_traces')
      .delete()
      .lte('expires_at', now.toISOString())
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
