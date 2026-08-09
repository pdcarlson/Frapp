import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IServiceEntryRepository } from '../../../domain/repositories/service-entry.repository.interface';
import {
  ServiceEntry,
  ServiceEntryFilters,
  ServiceLeaderboardRow,
} from '../../../domain/entities/service-entry.entity';

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
    return data;
  }

  async findByChapterFiltered(
    chapterId: string,
    filters: ServiceEntryFilters,
  ): Promise<ServiceEntry[]> {
    let query = this.supabase
      .from('service_entries')
      .select('*')
      .eq('chapter_id', chapterId);

    // Each filter is applied only when supplied, so an empty filter set
    // degrades to the same query findByChapter runs.
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.userId) query = query.eq('user_id', filters.userId);
    // Bounds are inclusive and compare against `date` (the day the service
    // happened), not created_at — a range means what the officer picking it
    // expects.
    if (filters.startDate) query = query.gte('date', filters.startDate);
    if (filters.endDate) query = query.lte('date', filters.endDate);

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });
    if (error) throw error;
    return data || [];
  }

  async leaderboard(
    chapterId: string,
    range: { startDate?: string; endDate?: string },
  ): Promise<ServiceLeaderboardRow[]> {
    const { data, error } = await this.supabase.rpc('get_service_leaderboard', {
      p_chapter_id: chapterId,
      p_start_date: range.startDate ?? null,
      p_end_date: range.endDate ?? null,
    });
    if (error) throw error;
    return data ?? [];
  }

  async create(data: Partial<ServiceEntry>): Promise<ServiceEntry> {
    const { data: created, error } = await this.supabase
      .from('service_entries')
      .insert(data as never)
      .select()
      .single();

    if (error) throw error;
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<ServiceEntry>,
  ): Promise<ServiceEntry> {
    const { data: updated, error } = await this.supabase
      .from('service_entries')
      .update(data as never)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  async approveAtomic(
    id: string,
    chapterId: string,
    reviewerId: string,
    reviewComment: string | null,
    points: number,
  ): Promise<ServiceEntry | null> {
    const { data, error } = await this.supabase.rpc('approve_service_entry', {
      p_entry_id: id,
      p_chapter_id: chapterId,
      p_reviewer_id: reviewerId,
      p_review_comment: reviewComment,
      p_points: points,
    });
    if (error) throw error;
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
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
