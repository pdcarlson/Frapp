import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IChatThreadRepository } from '#domain/repositories/chat-thread.repository.interface';
import { ChatMessageCursorNotFoundError } from '#domain/repositories/chat.repository.interface';
import type {
  ChatMessage,
  ChatThreadFollow,
  ChatThreadFollowState,
  FollowedThreadUnread,
} from '#domain/entities/chat.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { CHAT_MESSAGE_COLUMNS } from './supabase-chat-message.repository';

/** Message threads (#3785): replies on `chat_messages`, follows on `chat_thread_follows`. */
@Injectable()
export class SupabaseChatThreadRepository implements IChatThreadRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findReplies(
    rootId: string,
    options: { limit: number; before?: string; since?: string },
  ): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('thread_root_id', rootId)
      .order('created_at', { ascending: false })
      .limit(options.limit);

    if (options.before) {
      query = query.lt('created_at', options.before);
    }

    // The timeline's `since` contract (`findByChannel`), scoped to the thread.
    if (options.since) {
      const { data: pivot, error: pivotError } = await this.supabase
        .from('chat_messages')
        .select('created_at')
        .eq('id', options.since)
        .eq('thread_root_id', rootId)
        .maybeSingle();
      if (pivotError) throw new SupabaseQueryError(pivotError);
      if (!pivot) {
        throw new ChatMessageCursorNotFoundError(rootId, options.since);
      }
      query = query.gt('created_at', pivot.created_at);
    }

    const { data, error } = await query;
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findFollow(
    rootId: string,
    userId: string,
  ): Promise<ChatThreadFollow | null> {
    const { data, error } = await this.supabase
      .from('chat_thread_follows')
      .select('*')
      .eq('thread_root_id', rootId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findFollowStates(
    rootId: string,
    userIds: string[],
  ): Promise<Map<string, ChatThreadFollowState>> {
    const states = new Map<string, ChatThreadFollowState>();
    if (userIds.length === 0) return states;
    const { data, error } = await this.supabase
      .from('chat_thread_follows')
      .select('user_id, state')
      .eq('thread_root_id', rootId)
      .in('user_id', userIds);
    if (error) throw new SupabaseQueryError(error);
    for (const row of data ?? []) states.set(row.user_id, row.state);
    return states;
  }

  async ensureFollowing(
    rootId: string,
    channelId: string,
    userIds: string[],
  ): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    const { error } = await this.supabase.from('chat_thread_follows').upsert(
      unique.map((user_id) => ({
        thread_root_id: rootId,
        channel_id: channelId,
        user_id,
        state: 'following' as const,
      })),
      { onConflict: 'thread_root_id,user_id', ignoreDuplicates: true },
    );
    if (error) throw new SupabaseQueryError(error);
  }

  async setFollowState(
    rootId: string,
    channelId: string,
    userId: string,
    state: ChatThreadFollowState | null,
  ): Promise<void> {
    if (state === null) {
      const { error } = await this.supabase
        .from('chat_thread_follows')
        .delete()
        .eq('thread_root_id', rootId)
        .eq('user_id', userId);
      if (error) throw new SupabaseQueryError(error);
      return;
    }
    const { error } = await this.supabase.from('chat_thread_follows').upsert(
      {
        thread_root_id: rootId,
        channel_id: channelId,
        user_id: userId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_root_id,user_id' },
    );
    if (error) throw new SupabaseQueryError(error);
  }

  async markRead(
    rootId: string,
    channelId: string,
    userId: string,
    readAt: string,
  ): Promise<void> {
    // Two writes, both idempotent: create the row if missing (keeping any
    // existing state), then move the cursor forward only. A single upsert
    // would overwrite a later cursor from another device.
    await this.ensureFollowing(rootId, channelId, [userId]);
    const { error } = await this.supabase
      .from('chat_thread_follows')
      .update({ last_read_at: readAt, updated_at: readAt })
      .eq('thread_root_id', rootId)
      .eq('user_id', userId)
      .or(`last_read_at.is.null,last_read_at.lt."${readAt}"`);
    if (error) throw new SupabaseQueryError(error);
  }

  async findFollowedUnread(
    channelId: string,
    userId: string,
  ): Promise<FollowedThreadUnread[]> {
    const { data, error } = await this.supabase.rpc(
      'get_followed_thread_unread',
      { p_channel_id: channelId, p_user_id: userId },
    );
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map((row) => ({
      ...row,
      unread_count: Number(row.unread_count) || 0,
    }));
  }
}
