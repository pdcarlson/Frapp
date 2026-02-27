import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { IChatMessageRepository } from '../../../domain/repositories/chat.repository.interface';
import { ChatMessage } from '../../../domain/entities/chat.entity';

const DEFAULT_MESSAGE_LIMIT = 50;

@Injectable()
export class SupabaseChatMessageRepository implements IChatMessageRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<ChatMessage | null> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as ChatMessage | null;
  }

  async findByChannel(
    channelId: string,
    options?: { limit?: number; before?: string },
  ): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? DEFAULT_MESSAGE_LIMIT);

    if (options?.before) {
      query = query.lt('created_at', options.before);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as ChatMessage[]) || [];
  }

  async findPinnedByChannel(channelId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('channel_id', channelId)
      .eq('is_pinned', true)
      .order('pinned_at', { ascending: false });
    if (error) throw error;
    return (data as ChatMessage[]) || [];
  }

  async countPinnedByChannel(channelId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId)
      .eq('is_pinned', true);
    if (error) throw error;
    return count ?? 0;
  }

  async create(data: Partial<ChatMessage>): Promise<ChatMessage> {
    const { data: created, error } = await this.supabase
      .from('chat_messages')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as ChatMessage;
  }

  async update(id: string, data: Partial<ChatMessage>): Promise<ChatMessage> {
    const { data: updated, error } = await this.supabase
      .from('chat_messages')
      .update(data)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return updated as ChatMessage;
  }
}
