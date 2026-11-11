import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChatMessageLinkRepository } from '#domain/repositories/chat-message-link.repository.interface';
import type {
  ChatLinkMemberState,
  ChatLinkMemberStateValue,
  ChatMessageLink,
} from '#domain/entities/chat.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * `chat_message_links` and `chat_link_member_states` (#3897). Both tables have
 * RLS on and no policies: the API's service role is the only reader, and
 * every query here filters on `chapter_id` because nothing else would.
 */
@Injectable()
export class SupabaseChatMessageLinkRepository implements IChatMessageLinkRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findShowing(
    chapterId: string,
    options: { since: string; channelIds: string[]; limit: number },
  ): Promise<ChatMessageLink[]> {
    if (options.channelIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_message_links')
      .select('*')
      .eq('chapter_id', chapterId)
      .is('removed_at', null)
      .gt('posted_at', options.since)
      .in('channel_id', options.channelIds)
      .order('posted_at', { ascending: false })
      .limit(options.limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(
    chapterId: string,
    linkId: string,
  ): Promise<ChatMessageLink | null> {
    const { data, error } = await this.supabase
      .from('chat_message_links')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('id', linkId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async findStates(
    chapterId: string,
    userId: string,
    linkIds: string[],
  ): Promise<ChatLinkMemberState[]> {
    if (linkIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_link_member_states')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .in('link_id', linkIds);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async setState(
    chapterId: string,
    linkId: string,
    userId: string,
    state: ChatLinkMemberStateValue,
  ): Promise<void> {
    const row: TablesInsert<'chat_link_member_states'> = {
      link_id: linkId,
      user_id: userId,
      chapter_id: chapterId,
      state,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.supabase
      .from('chat_link_member_states')
      .upsert(row, { onConflict: 'link_id,user_id' });
    if (error) throw new SupabaseQueryError(error);
  }

  async clearState(
    chapterId: string,
    linkId: string,
    userId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_link_member_states')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('link_id', linkId)
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
  }

  async setRemoved(
    chapterId: string,
    linkId: string,
    removedBy: string | null,
  ): Promise<ChatMessageLink | null> {
    const { data, error } = await this.supabase
      .from('chat_message_links')
      .update({
        removed_at: removedBy ? new Date().toISOString() : null,
        removed_by: removedBy,
      })
      .eq('chapter_id', chapterId)
      .eq('id', linkId)
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }
}
