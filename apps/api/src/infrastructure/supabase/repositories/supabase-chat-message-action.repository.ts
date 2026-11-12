import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChatMessageActionRepository } from '#domain/repositories/chat.repository.interface';
import {
  ChatMessageActionDuplicateError,
  SignupClaimRefusedError,
} from '#domain/repositories/chat.repository.interface';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { ChatMessageAction } from '#domain/entities/chat.entity';
import { SupabaseQueryError } from '../supabase-query-error';

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
    const row: TablesInsert<'chat_message_actions'> = {
      message_id: data.message_id,
      user_id: data.user_id,
      action_type: data.action_type,
      payload: data.payload ?? {},
    };
    const { data: created, error } = await this.supabase
      .from('chat_message_actions')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new ChatMessageActionDuplicateError(
          data.message_id,
          data.user_id,
          data.action_type,
        );
      }
      throw new SupabaseQueryError(error);
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
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async updateForVote(
    messageId: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<ChatMessageAction | null> {
    const patch: TablesUpdate<'chat_message_actions'> = {
      payload,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('chat_message_actions')
      .update(patch)
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findActionsOnMessages(
    messageIds: string[],
    userId: string,
    actionType: string,
  ): Promise<Pick<ChatMessageAction, 'message_id' | 'payload'>[]> {
    if (messageIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_message_actions')
      .select('message_id, payload')
      .in('message_id', messageIds)
      .eq('user_id', userId)
      .eq('action_type', actionType);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map((row) => ({
      message_id: row.message_id,
      payload: row.payload ?? {},
    }));
  }

  async claimSignupSlots(
    messageId: string,
    userId: string,
    slotIds: string[],
    note: string | null,
  ): Promise<{ action: ChatMessageAction; updated: boolean }> {
    const { data, error } = await this.supabase.rpc('claim_signup_slots', {
      p_message_id: messageId,
      p_user_id: userId,
      p_slot_ids: slotIds,
      p_note: note,
    });
    if (error) {
      // The RPC names each refusal in its message and the slot in DETAIL
      // (`20261113040005_signup_headcount_close.sql`); anything else is a
      // failure.
      const reason = SIGNUP_REFUSALS[error.message];
      if (reason) {
        throw new SignupClaimRefusedError(reason, error.details || null);
      }
      throw new SupabaseQueryError(error);
    }
    const result = data as { action?: ChatMessageAction; updated?: boolean };
    if (!result?.action) {
      throw new Error('claim_signup_slots returned no row');
    }
    return { action: result.action, updated: result.updated === true };
  }
}

const SIGNUP_REFUSALS: Record<string, SignupClaimRefusedError['reason']> = {
  signup_card_missing: 'missing',
  signup_slot_unknown: 'unknown_slot',
  signup_slot_full: 'full',
  signup_closed: 'closed',
};
