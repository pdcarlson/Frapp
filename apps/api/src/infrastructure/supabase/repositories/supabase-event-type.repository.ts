import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { IEventTypeRepository } from '#domain/repositories/event-type.repository.interface';
import { EventType } from '#domain/entities/event-type.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';

@Injectable()
export class SupabaseEventTypeRepository implements IEventTypeRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<EventType[]> {
    const { data, error } = await this.supabase
      .from('event_types')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(id: string, chapterId: string): Promise<EventType | null> {
    const { data, error } = await this.supabase
      .from('event_types')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: TablesInsert<'event_types'>): Promise<EventType | null> {
    const { data: created, error } = await this.supabase
      .from('event_types')
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
    id: string,
    chapterId: string,
    data: Partial<Pick<EventType, 'name' | 'point_value' | 'is_mandatory'>>,
  ): Promise<EventType | null | undefined> {
    const { data: updated, error } = await this.supabase
      .from('event_types')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return updated ?? undefined;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('event_types')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }
}
