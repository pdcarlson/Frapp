import { Inject, Injectable } from '@nestjs/common';
import type {
  MeetingNextAgendaItem,
  NewMeetingNextAgendaItem,
} from '#domain/entities/meeting-next-agenda-item.entity';
import type { IMeetingNextAgendaItemRepository } from '#domain/repositories/meeting-next-agenda-item.repository.interface';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * The insert's conflict target, `meeting_next_agenda_items_suggestion_key` in
 * `20261120222934_meeting_next_agenda_items.sql`. The spec checks it
 * against the migration: a target that names no unique constraint fails
 * every write with 42P10, and no mocked client notices.
 */
export const MEETING_NEXT_AGENDA_ITEM_CONFLICT = 'ai_suggestion_id';

/** The most minutes one `in` filter carries. */
const IDS_PER_READ = 50;

/**
 * `meeting_next_agenda_items` (#5790). RLS on and no policies: the API's
 * service role is the only reader, and every query here filters on
 * `chapter_id` because nothing else would.
 */
@Injectable()
export class SupabaseMeetingNextAgendaItemRepository implements IMeetingNextAgendaItemRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async insert(row: NewMeetingNextAgendaItem): Promise<MeetingNextAgendaItem> {
    const insert: TablesInsert<'meeting_next_agenda_items'> = row;
    const { error } = await this.supabase
      .from('meeting_next_agenda_items')
      .upsert(insert, {
        onConflict: MEETING_NEXT_AGENDA_ITEM_CONFLICT,
        ignoreDuplicates: true,
      });
    if (error) throw new SupabaseQueryError(error);
    const saved = row.ai_suggestion_id
      ? await this.findBySuggestion(row.chapter_id, row.ai_suggestion_id)
      : null;
    if (!saved) {
      // Only a row with no suggestion, or one whose suggestion is another
      // chapter's, reads back nothing; neither is written from here.
      throw new Error('meeting_next_agenda_items: the row was not written');
    }
    return saved;
  }

  async delete(chapterId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_next_agenda_items')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }

  async findBySuggestion(
    chapterId: string,
    suggestionId: string,
  ): Promise<MeetingNextAgendaItem | null> {
    const { data, error } = await this.supabase
      .from('meeting_next_agenda_items')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('ai_suggestion_id', suggestionId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async listForMeetings(
    chapterId: string,
    meetingIds: readonly string[],
  ): Promise<MeetingNextAgendaItem[]> {
    const unique = [...new Set(meetingIds)];
    const rows: MeetingNextAgendaItem[] = [];
    for (let i = 0; i < unique.length; i += IDS_PER_READ) {
      const { data, error } = await this.supabase
        .from('meeting_next_agenda_items')
        .select('*')
        .eq('chapter_id', chapterId)
        .in('meeting_id', unique.slice(i, i + IDS_PER_READ))
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw new SupabaseQueryError(error);
      rows.push(...data);
    }
    return rows;
  }
}
