import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { IServiceEntryRepository } from '#domain/repositories/service-entry.repository.interface';
import {
  ServiceEntry,
  ServiceEntryFilters,
  ServiceLeaderboardRow,
} from '#domain/entities/service-entry.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';

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
    if (error) throw new SupabaseQueryError(error);
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
    if (error) throw new SupabaseQueryError(error);
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
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  /**
   * Insert, and translate a hit on `service_entries_chapter_proof_path_key`
   * into "here is the entry that already holds this proof file". The insert
   * names no id, and that index is the table's only other unique key, so a
   * `23505` here means the path is taken. That happens when two creates for
   * one receipt (a resend after a lost response) race past the service's own
   * lookup. A null re-read means that entry was deleted between the failed
   * insert and the read, and the original error is the honest answer.
   */
  async create(data: TablesInsert<'service_entries'>): Promise<ServiceEntry> {
    const { data: created, error } = await this.supabase
      .from('service_entries')
      .insert(data)
      .select()
      .single();

    if (error) {
      if (
        error.code === PG_UNIQUE_VIOLATION &&
        data.proof_path &&
        data.chapter_id
      ) {
        const holder = await this.findByProofPath(
          data.chapter_id,
          data.proof_path,
        );
        if (holder) return holder;
      }
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async findByProofPath(
    chapterId: string,
    proofPath: string,
  ): Promise<ServiceEntry | null> {
    const { data, error } = await this.supabase
      .from('service_entries')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('proof_path', proofPath)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async countByProofPath(
    chapterId: string,
    proofPath: string,
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from('service_entries')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq('proof_path', proofPath);
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }

  async rejectIfPending(
    id: string,
    chapterId: string,
    reviewerId: string,
    reviewComment: string | null,
  ): Promise<ServiceEntry | null> {
    const { data, error } = await this.supabase
      .from('service_entries')
      .update({
        status: 'REJECTED',
        reviewed_by: reviewerId,
        review_comment: reviewComment,
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', 'PENDING')
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
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
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }

  async deleteIfPending(
    id: string,
    chapterId: string,
  ): Promise<ServiceEntry | null> {
    const { data, error } = await this.supabase
      .from('service_entries')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', 'PENDING')
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }
}
