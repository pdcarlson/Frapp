import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChannelReadReceiptRepository } from '../../../domain/repositories/chat.repository.interface';
import { ChannelReadReceipt } from '../../../domain/entities/chat.entity';

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
    return data as ChannelReadReceipt | null;
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
    return data as ChannelReadReceipt;
  }
}
