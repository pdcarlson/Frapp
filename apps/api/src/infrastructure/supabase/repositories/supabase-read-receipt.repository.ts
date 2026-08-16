import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChannelReadReceiptRepository } from '../../../domain/repositories/chat.repository.interface';
import {
  ChannelReadReceipt,
  ChannelUnreadCount,
} from '../../../domain/entities/chat.entity';

@Injectable()
export class SupabaseReadReceiptRepository implements IChannelReadReceiptRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChannelAndUser(
    channelId: string,
    userId: string,
  ): Promise<ChannelReadReceipt | null> {
    const { data, error } = await this.supabase
      .from('channel_read_receipts')
      .select('*')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async upsert(
    channelId: string,
    userId: string,
    lastReadAt: string,
  ): Promise<ChannelReadReceipt> {
    const { data, error } = await this.supabase
      .from('channel_read_receipts')
      .upsert(
        {
          channel_id: channelId,
          user_id: userId,
          last_read_at: lastReadAt,
        } as never,
        { onConflict: 'channel_id,user_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getUnreadCounts(
    chapterId: string,
    userId: string,
  ): Promise<ChannelUnreadCount[]> {
    const { data, error } = await this.supabase.rpc(
      'get_channel_unread_counts',
      { p_chapter_id: chapterId, p_user_id: userId },
    );
    if (error) throw error;
    // `bigint` crosses PostgREST as a JSON number for these magnitudes, but the
    // counts are the whole point of the call, so coerce rather than trust the
    // wire type — a string here would silently render as "12" + "3" concatenated
    // in any arithmetic downstream.
    return (data ?? []).map((row) => ({
      channel_id: row.channel_id,
      unread_count: Number(row.unread_count),
      mention_count: Number(row.mention_count),
    }));
  }
}
