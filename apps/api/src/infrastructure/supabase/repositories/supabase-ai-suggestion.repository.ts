import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import type {
  AiSuggestionDecision,
  IAiSuggestionRepository,
  ListPendingAiSuggestionsQuery,
  NewAiSuggestion,
} from '#domain/repositories/ai-suggestion.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/** What a decided or expired row keeps of its text: nothing. */
const NO_TEXT = {
  payload: {},
  quote: null,
  quote_author_id: null,
} as const satisfies TablesUpdate<'ai_suggestions'>;

/**
 * AI suggestions (#4309). The API reaches the table through the service-role
 * client, which bypasses RLS, and the table enables RLS with no policies, so
 * no client reads it directly: a suggestion is served only through
 * `AiSuggestionService`, which filters it to people who could accept it.
 */
@Injectable()
export class SupabaseAiSuggestionRepository implements IAiSuggestionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async insertBatch(
    chapterId: string,
    rows: readonly NewAiSuggestion[],
  ): Promise<AiSuggestion[]> {
    if (rows.length === 0) return [];
    const inserts: TablesInsert<'ai_suggestions'>[] = rows.map((row) => ({
      ...row,
      chapter_id: chapterId,
    }));
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .upsert(inserts, {
        onConflict: 'batch_id,ordinal',
        ignoreDuplicates: true,
      })
      .select();
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(chapterId: string, id: string): Promise<AiSuggestion | null> {
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async listPending(
    chapterId: string,
    query: ListPendingAiSuggestionsQuery,
  ): Promise<AiSuggestion[]> {
    if (query.permissions && query.permissions.length === 0) return [];
    let request = this.supabase
      .from('ai_suggestions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('status', 'pending')
      .gt('expires_at', query.now);
    if (query.permissions) {
      request = request.in('required_permission', [...query.permissions]);
    }
    if (query.source) {
      request = request
        .eq('source_type', query.source.type)
        .eq('source_id', query.source.id);
    }
    const { data, error } = await request
      .order('created_at', { ascending: false })
      .order('ordinal', { ascending: true })
      .limit(query.limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async claim(
    chapterId: string,
    id: string,
    decision: AiSuggestionDecision,
  ): Promise<AiSuggestion | null> {
    const update: TablesUpdate<'ai_suggestions'> = {
      ...NO_TEXT,
      status: decision.status,
      decided_by: decision.decidedBy,
      decided_at: decision.now,
      edited: decision.edited,
    };
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .update(update)
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'pending')
      .gt('expires_at', decision.now)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async release(
    chapterId: string,
    id: string,
    original: Pick<AiSuggestion, 'payload' | 'quote' | 'quote_author_id'>,
  ): Promise<void> {
    const update: TablesUpdate<'ai_suggestions'> = {
      payload: original.payload,
      quote: original.quote,
      quote_author_id: original.quote_author_id,
      status: 'pending',
      decided_by: null,
      decided_at: null,
      edited: false,
    };
    const { error } = await this.supabase
      .from('ai_suggestions')
      .update(update)
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'accepted')
      .is('result_id', null);
    if (error) throw new SupabaseQueryError(error);
  }

  async setResult(
    chapterId: string,
    id: string,
    resultId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('ai_suggestions')
      .update({ result_id: resultId })
      .eq('chapter_id', chapterId)
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }

  async expireDue(
    now: string,
  ): Promise<{ chapter_id: string; kind: AiSuggestion['kind'] }[]> {
    // Cross-chapter by design: the hourly sweep serves the whole database.
    const update: TablesUpdate<'ai_suggestions'> = {
      ...NO_TEXT,
      status: 'expired',
    };
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .update(update)
      .eq('status', 'pending')
      .lte('expires_at', now)
      .select('chapter_id, kind');
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }
}
