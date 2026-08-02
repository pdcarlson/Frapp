import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChatCategoryRepository } from '../../../domain/repositories/chat.repository.interface';
import { ChatChannelCategory } from '../../../domain/entities/chat.entity';

@Injectable()
export class SupabaseChatCategoryRepository implements IChatCategoryRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChatChannelCategory[]> {
    const { data, error } = await this.supabase
      .from('chat_channel_categories')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async create(
    data: Partial<ChatChannelCategory>,
  ): Promise<ChatChannelCategory> {
    const { data: created, error } = await this.supabase
      .from('chat_channel_categories')
      .insert(data as never)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChatChannelCategory | null> {
    const { data, error } = await this.supabase
      .from('chat_channel_categories')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<ChatChannelCategory>,
  ): Promise<ChatChannelCategory> {
    const { data: updated, error } = await this.supabase
      .from('chat_channel_categories')
      .update(data as never)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return updated;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_channel_categories')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
