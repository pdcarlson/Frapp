import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IPointTransactionRepository } from '../../../domain/repositories/point-transaction.repository.interface';
import { PointTransaction } from '../../../domain/entities/point-transaction.entity';

@Injectable()
export class SupabasePointTransactionRepository implements IPointTransactionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: Partial<PointTransaction>): Promise<PointTransaction> {
    const { data: created, error } = await this.supabase
      .from('point_transactions')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return created as PointTransaction;
  }

  async findByUser(
    chapterId: string,
    userId: string,
  ): Promise<PointTransaction[]> {
    const { data, error } = await this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as PointTransaction[]) || [];
  }

  async findByChapter(chapterId: string): Promise<PointTransaction[]> {
    const { data, error } = await this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as PointTransaction[]) || [];
  }

  async countRecentAdjustments(
    adminUserId: string,
    chapterId: string,
    since: Date,
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from('point_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq('metadata->>adjusted_by', adminUserId)
      .gte('created_at', since.toISOString());
    if (error) throw error;
    return count ?? 0;
  }
}
