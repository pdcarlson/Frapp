import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IServiceEntryRepository } from '../../../domain/repositories/service-entry.repository.interface';
import { ServiceEntry } from '../../../domain/entities/service-entry.entity';

@Injectable()
export class SupabaseServiceEntryRepository implements IServiceEntryRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<ServiceEntry | null> {
    const { data, error } = await this.supabase
      .from('service_entries')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data as ServiceEntry | null;
  }

  async findByChapter(chapterId: string): Promise<ServiceEntry[]> {
    const { data, error } = await this.supabase
      .from('service_entries')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as ServiceEntry[]) || [];
  }

  async findByUser(chapterId: string, userId: string): Promise<ServiceEntry[]> {
    const { data, error } = await this.supabase
      .from('service_entries')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as ServiceEntry[]) || [];
  }

  async create(data: Partial<ServiceEntry>): Promise<ServiceEntry> {
    const { data: created, error } = await this.supabase
      .from('service_entries')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return created as ServiceEntry;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<ServiceEntry>,
  ): Promise<ServiceEntry> {
    const { data: updated, error } = await this.supabase
      .from('service_entries')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw error;
    return updated as ServiceEntry;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('service_entries')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw error;
  }
}
