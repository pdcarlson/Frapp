import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChatMessageActionRepository } from '../../../domain/repositories/chat.repository.interface';
import {
  ChatMessageActionDuplicateError,
  PG_UNIQUE_VIOLATION,
} from '../../../domain/repositories/chat.repository.interface';
import { ChatMessageAction } from '../../../domain/entities/chat.entity';

@Injectable()
export class SupabaseChatMessageActionRepository implements IChatMessageActionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: {
    message_id: string;
    user_id: string;
    action_type: string;
    payload?: Record<string, unknown>;
  }): Promise<ChatMessageAction> {
    const { data: created, error } = await this.supabase
      .from('chat_message_actions')
      .insert({
        message_id: data.message_id,
        user_id: data.user_id,
        action_type: data.action_type,
        payload: data.payload ?? {},
      } as never)
      .select('*')
      .single();
    if (error) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ChatMessageActionDuplicateError(
          data.message_id,
          data.user_id,
          data.action_type,
        );
      }
      throw error;
    }
    return created;
  }

  async findOne(
    messageId: string,
    userId: string,
    actionType: string,
  ): Promise<ChatMessageAction | null> {
    const { data, error } = await this.supabase
      .from('chat_message_actions')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async updateForVote(
    messageId: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<ChatMessageAction | null> {
    const { data, error } = await this.supabase
      .from('chat_message_actions')
      .update({
        payload,
        created_at: new Date().toISOString(),
      } as never)
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
}
