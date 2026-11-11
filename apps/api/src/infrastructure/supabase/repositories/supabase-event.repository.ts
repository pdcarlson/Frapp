import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IEventRepository } from '#domain/repositories/event.repository.interface';
import { Event } from '#domain/entities/event.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseEventRepository implements IEventRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<Event | null> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(
    chapterId: string,
    window?: { endsAfter: string; startsBefore: string },
  ): Promise<Event[]> {
    let query = this.supabase
      .from('events')
      .select('*')
      .eq('chapter_id', chapterId);
    if (window) {
      query = query
        .gte('end_time', window.endsAfter)
        .lte('start_time', window.startsBefore);
    }
    const { data, error } = await query.order('start_time', {
      ascending: true,
    });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findCreatedBy(
    chapterId: string,
    createdBy: string,
    endsAfter: string,
    limit: number,
  ): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('created_by', createdBy)
      .gte('end_time', endsAfter)
      .order('start_time', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findChildren(parentId: string, chapterId: string): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('parent_event_id', parentId)
      .eq('chapter_id', chapterId)
      .order('start_time', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async create(data: TablesInsert<'events'>): Promise<Event> {
    const { data: created, error } = await this.supabase
      .from('events')
      .insert(data)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  /**
   * One array insert: PostgREST sends it as a single `INSERT`, so a series'
   * occurrences land together or not at all (#3235).
   */
  async createMany(rows: TablesInsert<'events'>[]): Promise<Event[]> {
    if (rows.length === 0) return [];

    const { data: created, error } = await this.supabase
      .from('events')
      .insert(rows)
      .select();

    if (error) throw new SupabaseQueryError(error);
    return created ?? [];
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'events'>,
  ): Promise<Event> {
    const { data: updated, error } = await this.supabase
      .from('events')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async updateMany(
    ids: string[],
    chapterId: string,
    data: TablesUpdate<'events'>,
  ): Promise<Event[]> {
    // PostgREST turns an empty `.in()` list into a match-nothing filter, but the
    // round trip is pure waste and an empty series is the common case.
    if (ids.length === 0) return [];

    const { data: updated, error } = await this.supabase
      .from('events')
      .update(data)
      .in('id', ids)
      .eq('chapter_id', chapterId)
      .select();

    if (error) throw new SupabaseQueryError(error);
    return updated || [];
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('events')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw new SupabaseQueryError(error);
  }

  async deleteMany(ids: string[], chapterId: string): Promise<void> {
    if (ids.length === 0) return;

    const { error } = await this.supabase
      .from('events')
      .delete()
      .in('id', ids)
      .eq('chapter_id', chapterId);

    if (error) throw new SupabaseQueryError(error);
  }
}
