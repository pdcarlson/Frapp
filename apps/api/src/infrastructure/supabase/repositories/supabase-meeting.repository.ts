import { MEETING_TYPES, type MeetingType } from '@repo/validation';
import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  IMeetingRepository,
  MeetingWrite,
} from '#domain/repositories/meeting.repository.interface';
import type { Meeting, MeetingTemplate } from '#domain/entities/meeting.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';

@Injectable()
export class SupabaseMeetingRepository implements IMeetingRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(chapterId: string, id: string): Promise<Meeting | null> {
    const { data, error } = await this.supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByEvent(
    chapterId: string,
    eventId: string,
  ): Promise<Meeting | null> {
    const { data, error } = await this.supabase
      .from('meetings')
      .select('*')
      .eq('event_id', eventId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(chapterId: string, limit: number): Promise<Meeting[]> {
    const { data, error } = await this.supabase
      .from('meetings')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('event_start_time', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findRecordedIds(
    chapterId: string,
    meetingIds: readonly string[],
  ): Promise<Set<string>> {
    if (meetingIds.length === 0) return new Set();
    const { data, error } = await this.supabase
      .from('meeting_recordings')
      .select('meeting_id')
      .eq('chapter_id', chapterId)
      .in('meeting_id', [...meetingIds])
      .neq('status', 'failed');
    if (error) throw new SupabaseQueryError(error);
    return new Set((data ?? []).map((row) => row.meeting_id));
  }

  async findPostedSince(
    chapterId: string,
    since: string,
    limit: number,
  ): Promise<Meeting[]> {
    const { data, error } = await this.supabase
      .from('meetings')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('status', 'posted')
      .gte('event_start_time', since)
      .order('event_start_time', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findPostedBefore(
    chapterId: string,
    before: string,
    meetingType: MeetingType | null,
    limit: number,
  ): Promise<Meeting[]> {
    let query = this.supabase
      .from('meetings')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('status', 'posted');
    // Null reads every type but Standards, which isn't one of
    // `MEETING_TYPES`: its minutes never reach AI or another meeting (#5534).
    query =
      meetingType === null
        ? query.in('meeting_type', [...MEETING_TYPES])
        : query.eq('meeting_type', meetingType);
    const { data, error } = await query
      .lt('event_start_time', before)
      .order('event_start_time', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async create(data: TablesInsert<'meetings'>): Promise<Meeting | null> {
    const { data: created, error } = await this.supabase
      .from('meetings')
      .insert(data)
      .select()
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async update(
    chapterId: string,
    id: string,
    expectedUpdatedAt: string,
    data: MeetingWrite,
  ): Promise<Meeting | null> {
    const patch: TablesUpdate<'meetings'> = data;
    const { data: updated, error } = await this.supabase
      .from('meetings')
      .update(patch)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('updated_at', expectedUpdatedAt)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async delete(chapterId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from('meetings')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async findTemplate(chapterId: string): Promise<MeetingTemplate | null> {
    const { data, error } = await this.supabase
      .from('meeting_templates')
      .select('*')
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async upsertTemplate(
    chapterId: string,
    sections: string[],
    updatedBy: string,
  ): Promise<MeetingTemplate> {
    const row: TablesInsert<'meeting_templates'> = {
      chapter_id: chapterId,
      sections,
      updated_by: updatedBy,
    };
    const { data, error } = await this.supabase
      .from('meeting_templates')
      .upsert(row, { onConflict: 'chapter_id' })
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }
}
