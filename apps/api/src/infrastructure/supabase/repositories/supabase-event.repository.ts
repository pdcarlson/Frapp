import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IEventRepository } from '#domain/repositories/event.repository.interface';
import { Event } from '#domain/entities/event.entity';

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
    if (error) throw error;
    return data;
  }

  async findByChapter(chapterId: string): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('start_time', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async findChildren(parentId: string, chapterId: string): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('parent_event_id', parentId)
      .eq('chapter_id', chapterId)
      .order('start_time', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async create(data: TablesInsert<'events'>): Promise<Event> {
    const { data: created, error } = await this.supabase
      .from('events')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return created;
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

    if (error) throw error;
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

    if (error) throw error;
    return updated || [];
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('events')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw error;
  }

  async deleteMany(ids: string[], chapterId: string): Promise<void> {
    if (ids.length === 0) return;

    const { error } = await this.supabase
      .from('events')
      .delete()
      .in('id', ids)
      .eq('chapter_id', chapterId);

    if (error) throw error;
  }
}
