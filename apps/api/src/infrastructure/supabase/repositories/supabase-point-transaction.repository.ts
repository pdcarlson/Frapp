import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import {
  IPointTransactionRepository,
  PointTransactionDuplicateError,
  type ListChapterPointTransactionsOptions,
} from '../../../domain/repositories/point-transaction.repository.interface';
import { PG_UNIQUE_VIOLATION } from '../../../domain/repositories/chat.repository.interface';
import { PointTransaction } from '../../../domain/entities/point-transaction.entity';

@Injectable()
export class SupabasePointTransactionRepository implements IPointTransactionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(
    data: TablesInsert<'point_transactions'>,
  ): Promise<PointTransaction> {
    const { data: created, error } = await this.supabase
      .from('point_transactions')
      .insert(data)
      .select()
      .single();

    if (error) {
      // `idx_point_transactions_dedupe` rejecting the insert is not a failure:
      // it means this idempotency key already committed a row, and the caller
      // should return that row. Translated to a typed error here so the service
      // never has to know a Postgres error code — the same seam
      // `SupabaseChatMessageRepository` uses for `chat_messages`.
      if (
        (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
        data.chapter_id &&
        data.client_message_id
      ) {
        throw new PointTransactionDuplicateError(
          data.chapter_id,
          data.client_message_id,
        );
      }
      throw error;
    }
    return created;
  }

  async findByClientMessageId(
    chapterId: string,
    clientMessageId: string,
  ): Promise<PointTransaction | null> {
    const { data, error } = await this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('client_message_id', clientMessageId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
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
    return data || [];
  }

  async findByChapter(chapterId: string): Promise<PointTransaction[]> {
    const { data, error } = await this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async findByChapterFiltered(
    chapterId: string,
    options: ListChapterPointTransactionsOptions,
  ): Promise<PointTransaction[]> {
    let q = this.supabase
      .from('point_transactions')
      .select('*')
      .eq('chapter_id', chapterId);

    if (options.userId) {
      q = q.eq('user_id', options.userId);
    }
    if (options.category) {
      q = q.eq('category', options.category);
    }
    if (options.flagged === true) {
      q = q.contains('metadata', { flagged: true });
    } else if (options.flagged === false) {
      q = q.not('metadata', 'cs', '{"flagged":true}');
    }
    if (options.before) {
      q = q.lt('created_at', options.before);
    }

    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(options.limit);
    if (error) throw error;
    return data || [];
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
