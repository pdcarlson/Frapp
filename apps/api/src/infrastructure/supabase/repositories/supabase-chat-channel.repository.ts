import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { IChatChannelRepository } from '../../../domain/repositories/chat.repository.interface';
import { ChatChannel } from '../../../domain/entities/chat.entity';

@Injectable()
export class SupabaseChatChannelRepository implements IChatChannelRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<ChatChannel | null> {
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data as ChatChannel | null;
  }

  async findByChapter(chapterId: string): Promise<ChatChannel[]> {
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as ChatChannel[]) || [];
  }

  async findDm(
    chapterId: string,
    memberIds: string[],
  ): Promise<ChatChannel | null> {
    const sorted = [...memberIds].sort();
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('type', 'DM')
      .contains('member_ids', sorted);
    if (error) throw error;
    const match = (data as ChatChannel[])?.find(
      (ch) =>
        ch.member_ids &&
        ch.member_ids.length === sorted.length &&
        [...ch.member_ids].sort().every((id, i) => id === sorted[i]),
    );
    return match ?? null;
  }

  async create(data: Partial<ChatChannel>): Promise<ChatChannel> {
    const { data: created, error } = await this.supabase
      .from('chat_channels')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as ChatChannel;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<ChatChannel>,
  ): Promise<ChatChannel> {
    const { data: updated, error } = await this.supabase
      .from('chat_channels')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return updated as ChatChannel;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_channels')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
