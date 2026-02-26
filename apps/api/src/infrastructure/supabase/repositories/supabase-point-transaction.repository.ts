import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IPointTransactionRepository } from '../../../domain/repositories/point-transaction.repository.interface';
import { PointTransaction } from '../../../domain/entities/point-transaction.entity';

@Injectable()
export class SupabasePointTransactionRepository implements IPointTransactionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
    const { data } = await this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    return (data as PointTransaction[]) || [];
  }

  async findByChapter(chapterId: string): Promise<PointTransaction[]> {
    const { data } = await this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });

    return (data as PointTransaction[]) || [];
  }
}
