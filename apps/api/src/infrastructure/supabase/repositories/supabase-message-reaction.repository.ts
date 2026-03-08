import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IMessageReactionRepository } from '../../../domain/repositories/chat.repository.interface';
import { MessageReaction } from '../../../domain/entities/chat.entity';

@Injectable()
export class SupabaseMessageReactionRepository implements IMessageReactionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByMessage(messageId: string): Promise<MessageReaction[]> {
    const { data, error } = await this.supabase
      .from('message_reactions')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as MessageReaction[]) || [];
  }

  async findOne(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction | null> {
    const { data, error } = await this.supabase
      .from('message_reactions')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji)
      .maybeSingle();
    if (error) throw error;
    return data as MessageReaction | null;
  }

  async create(data: Partial<MessageReaction>): Promise<MessageReaction> {
    const { data: created, error } = await this.supabase
      .from('message_reactions')
      .insert(data as never)
      .select()
      .single();
    if (error) throw error;
    return created as MessageReaction;
  }

  async delete(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    if (error) throw error;
  }
}
