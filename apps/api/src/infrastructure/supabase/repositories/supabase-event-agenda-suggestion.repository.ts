import { Inject, Injectable } from '@nestjs/common';
import type {
  EventAgendaSuggestion,
  EventAgendaSuggestionRun,
  EventAgendaSuggestionStatus,
} from '#domain/entities/event-agenda-suggestion.entity';
import type {
  EventAgendaSuggestionDraft,
  IEventAgendaSuggestionRepository,
} from '#domain/repositories/event-agenda-suggestion.repository.interface';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * The insert's conflict target, `event_agenda_suggestions_event_key` in
 * `20261118191604_event_agenda_suggestions.sql`. The spec checks it against
 * the migration: a target that names no unique constraint fails every write
 * with 42P10, and no mocked client notices.
 */
export const EVENT_AGENDA_SUGGESTION_CONFLICT = 'event_id,dedupe_key';
/** `event_agenda_suggestion_runs`'s primary key, checked the same way. */
export const EVENT_AGENDA_SUGGESTION_RUN_CONFLICT = 'event_id';

/** The most keys one `in` filter carries. */
const KEYS_PER_READ = 50;

/**
 * `event_agenda_suggestions` and `event_agenda_suggestion_runs` (#5534). RLS
 * on and no policies: the API's service role is the only reader, and every
 * query here filters on `chapter_id` because nothing else would.
 */
@Injectable()
export class SupabaseEventAgendaSuggestionRepository implements IEventAgendaSuggestionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async listForEvent(
    chapterId: string,
    eventId: string,
  ): Promise<EventAgendaSuggestion[]> {
    const { data, error } = await this.supabase
      .from('event_agenda_suggestions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async insertMany(
    drafts: readonly EventAgendaSuggestionDraft[],
  ): Promise<void> {
    if (drafts.length === 0) return;
    const rows: TablesInsert<'event_agenda_suggestions'>[] = drafts.map(
      (draft) => ({ ...draft, status: 'open' }),
    );
    const { error } = await this.supabase
      .from('event_agenda_suggestions')
      .upsert(rows, {
        onConflict: EVENT_AGENDA_SUGGESTION_CONFLICT,
        ignoreDuplicates: true,
      });
    if (error) throw new SupabaseQueryError(error);
  }

  async deleteOpen(
    chapterId: string,
    eventId: string,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .from('event_agenda_suggestions')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .eq('status', 'open')
      .in('id', [...ids]);
    if (error) throw new SupabaseQueryError(error);
  }

  async decide(
    chapterId: string,
    eventId: string,
    id: string,
    change: {
      status: Exclude<EventAgendaSuggestionStatus, 'open'>;
      agenda_item_id: string | null;
      decided_by: string;
      decided_at: string;
    },
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('event_agenda_suggestions')
      .update(change)
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .eq('id', id)
      .eq('status', 'open')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data.length > 0;
  }

  async addedKeys(
    chapterId: string,
    keys: readonly string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    const unique = [...new Set(keys)];
    for (let i = 0; i < unique.length; i += KEYS_PER_READ) {
      const { data, error } = await this.supabase
        .from('event_agenda_suggestions')
        .select('dedupe_key')
        .eq('chapter_id', chapterId)
        .eq('status', 'added')
        .in('dedupe_key', unique.slice(i, i + KEYS_PER_READ));
      if (error) throw new SupabaseQueryError(error);
      for (const row of data) found.add(row.dedupe_key);
    }
    return found;
  }

  async listDecided(
    chapterId: string,
    limit: number,
  ): Promise<EventAgendaSuggestion[]> {
    const { data, error } = await this.supabase
      .from('event_agenda_suggestions')
      .select('*')
      .eq('chapter_id', chapterId)
      .neq('status', 'open')
      .order('decided_at', { ascending: false })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findRun(
    chapterId: string,
    eventId: string,
  ): Promise<EventAgendaSuggestionRun | null> {
    const { data, error } = await this.supabase
      .from('event_agenda_suggestion_runs')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async saveRun(run: EventAgendaSuggestionRun): Promise<void> {
    const row: TablesInsert<'event_agenda_suggestion_runs'> = run;
    const { error } = await this.supabase
      .from('event_agenda_suggestion_runs')
      .upsert(row, { onConflict: EVENT_AGENDA_SUGGESTION_RUN_CONFLICT });
    if (error) throw new SupabaseQueryError(error);
  }
}
