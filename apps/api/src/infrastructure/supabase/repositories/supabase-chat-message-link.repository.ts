import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IChatMessageLinkRepository,
  LinkTitleCandidate,
} from '#domain/repositories/chat-message-link.repository.interface';
import type {
  ChatLinkMemberState,
  ChatLinkMemberStateValue,
  ChatMessageLink,
} from '#domain/entities/chat.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { chunkIds } from '#domain/utils/chunk-ids';

/** What the title sweep reads of a link: no poster, message or channel. */
const TITLE_CANDIDATE_COLUMNS = 'id, chapter_id, url';

/**
 * `chat_message_links` and `chat_link_member_states` (#3897). Both tables have
 * RLS on and no policies: the API's service role is the only reader, and
 * every query here filters on `chapter_id` because nothing else would. The
 * title sweep's two reads are the exception (#4187): they walk every
 * chapter's unread links by design, and return only ids and URLs.
 */
@Injectable()
export class SupabaseChatMessageLinkRepository implements IChatMessageLinkRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * The channel ids go out in `chunkIds` batches: a member of a
   * Discord-imported chapter can read hundreds of channels, and one `in`
   * list that long is a `414` (#3265). Each batch takes the newest `limit`,
   * so the merge's newest `limit` is the same as one query's would be.
   */
  async findShowing(
    chapterId: string,
    options: { since: string; channelIds: string[]; limit: number },
  ): Promise<ChatMessageLink[]> {
    const batches = await Promise.all(
      chunkIds(options.channelIds).map(async (channelIds) => {
        const { data, error } = await this.supabase
          .from('chat_message_links')
          .select('*')
          .eq('chapter_id', chapterId)
          .is('removed_at', null)
          .gt('posted_at', options.since)
          .in('channel_id', channelIds)
          .order('posted_at', { ascending: false })
          .limit(options.limit);
        if (error) throw new SupabaseQueryError(error);
        return data ?? [];
      }),
    );
    return batches
      .flat()
      .sort(
        (a, b) =>
          new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime(),
      )
      .slice(0, options.limit);
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
    const batches = await Promise.all(
      chunkIds(linkIds).map(async (ids) => {
        const { data, error } = await this.supabase
          .from('chat_link_member_states')
          .select('*')
          .eq('chapter_id', chapterId)
          .eq('user_id', userId)
          .in('link_id', ids);
        if (error) throw new SupabaseQueryError(error);
        return data ?? [];
      }),
    );
    return batches.flat();
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

  async findTitleUnchecked(options: {
    since: string;
    limit: number;
  }): Promise<LinkTitleCandidate[]> {
    const { data, error } = await this.supabase
      .from('chat_message_links')
      .select(TITLE_CANDIDATE_COLUMNS)
      .is('title_checked_at', null)
      .is('removed_at', null)
      .gt('posted_at', options.since)
      .order('posted_at', { ascending: false })
      .limit(options.limit);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []) as LinkTitleCandidate[];
  }

  async claimForTitle(linkIds: string[]): Promise<LinkTitleCandidate[]> {
    if (linkIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_message_links')
      .update({ title_checked_at: new Date().toISOString() })
      .in('id', linkIds)
      .is('title_checked_at', null)
      .select(TITLE_CANDIDATE_COLUMNS);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []) as LinkTitleCandidate[];
  }

  async setTitle(
    chapterId: string,
    linkIds: string[],
    title: string,
  ): Promise<void> {
    if (linkIds.length === 0) return;
    const { error } = await this.supabase
      .from('chat_message_links')
      .update({ title })
      .eq('chapter_id', chapterId)
      .in('id', linkIds);
    if (error) throw new SupabaseQueryError(error);
  }
}
