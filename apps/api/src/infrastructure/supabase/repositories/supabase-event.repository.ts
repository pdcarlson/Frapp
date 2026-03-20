import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IEventRepository } from '../../../domain/repositories/event.repository.interface';
import { Event } from '../../../domain/entities/event.entity';

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
    return data as Event | null;
  }

  async findByChapter(chapterId: string): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('start_time', { ascending: true });
    if (error) throw error;
    return (data as Event[]) || [];
  }

  async create(data: Partial<Event>): Promise<Event> {
    const { data: created, error } = await this.supabase
      .from('events')
      .insert(data as never)
      .select()
      .single();

    if (error) throw error;
    return created as Event;
  }

  async createMany(data: Partial<Event>[]): Promise<void> {
    if (!data.length) return;
    const { error } = await this.supabase.from('events').insert(data as never);
    if (error) throw error;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<Event>,
  ): Promise<Event> {
    const { data: updated, error } = await this.supabase
      .from('events')
      .update(data as never)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw error;
    return updated as Event;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('events')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw error;
  }
}
