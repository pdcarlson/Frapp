import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import type {
  AiSuggestionClaim,
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

/** An accept that didn't finish, back to waiting with its text. */
const BACK_TO_WAITING = {
  status: 'pending',
  decided_by: null,
  decided_at: null,
  edited: false,
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

  async listKeyedForSource(
    chapterId: string,
    source: { type: AiSuggestion['source_type']; id: string },
    kind: AiSuggestion['kind'],
  ): Promise<AiSuggestion[]> {
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('source_type', source.type)
      .eq('source_id', source.id)
      .eq('kind', kind)
      .not('dedupe_key', 'is', null);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async deletePending(
    chapterId: string,
    ids: readonly string[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('status', 'pending')
      .in('id', [...ids])
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async listUnnotified(
    chapterId: string,
    batchId: string,
  ): Promise<AiSuggestion[]> {
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .is('notified_at', null)
      .order('ordinal', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async markNotified(
    chapterId: string,
    ids: readonly string[],
    now: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .from('ai_suggestions')
      .update({ notified_at: now })
      .eq('chapter_id', chapterId)
      .in('id', [...ids]);
    if (error) throw new SupabaseQueryError(error);
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
      // One batch is written at one instant, so within it the order the
      // source gave them holds: minutes' action items read top to bottom.
      .order('ordinal', { ascending: true })
      .order('id', { ascending: true })
      .range(query.offset, query.offset + query.limit - 1);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async claim(
    chapterId: string,
    id: string,
    claim: AiSuggestionClaim,
  ): Promise<AiSuggestion | null> {
    const update: TablesUpdate<'ai_suggestions'> = {
      // An accept keeps the text until the change is made (`finishAccept`).
      ...(claim.status === 'dismissed' ? NO_TEXT : {}),
      status: claim.status,
      decided_by: claim.decidedBy,
      decided_at: claim.now,
      edited: claim.edited,
    };
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .update(update)
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'pending')
      .gt('expires_at', claim.now)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async finishAccept(
    chapterId: string,
    id: string,
    resultId: string,
  ): Promise<AiSuggestion | null> {
    const update: TablesUpdate<'ai_suggestions'> = {
      ...NO_TEXT,
      status: 'accepted',
      result_id: resultId,
    };
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .update(update)
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'accepting')
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async release(chapterId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from('ai_suggestions')
      .update(BACK_TO_WAITING)
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'accepting');
    if (error) throw new SupabaseQueryError(error);
  }

  async releaseStale(before: string): Promise<number> {
    // Cross-chapter by design: the hourly sweep serves the whole database.
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .update(BACK_TO_WAITING)
      .eq('status', 'accepting')
      .lt('decided_at', before)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length;
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

  async dropQuotesBy(userId: string): Promise<number> {
    // Cross-chapter by design: one answer on the AI sheet covers every
    // chapter the person is in. Decided rows already hold no quote.
    const update: TablesUpdate<'ai_suggestions'> = {
      quote: null,
      quote_author_id: null,
    };
    const { data, error } = await this.supabase
      .from('ai_suggestions')
      .update(update)
      .eq('quote_author_id', userId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
