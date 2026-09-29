import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ChatSidebarFilters,
  IChatSidebarRepository,
} from '#domain/repositories/chat-sidebar.repository.interface';
import type { ChatSidebarPreferences } from '#domain/entities/chat-sidebar.entity';

/**
 * A member's own sidebar arrangement (#2877).
 *
 * Every query filters on `chapter_id` and `user_id`. The API reaches both
 * tables with the service-role client, which bypasses RLS (both tables enable
 * it with no policies), so these predicates are the whole of the boundary
 * between one member's arrangement and another's.
 */
@Injectable()
export class SupabaseChatSidebarRepository implements IChatSidebarRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findPreferences(
    chapterId: string,
    userId: string,
  ): Promise<ChatSidebarPreferences | null> {
    const { data, error } = await this.supabase
      .from('chat_sidebar_preferences')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * An upsert naming only the filters given. PostgREST's merge on conflict sets
   * just the columns in the payload, so a filter the caller left out keeps its
   * stored value, and `collapsed_sections` is never written from here: the
   * RPC below owns it, and a read-modify-write of the array would lose a fold
   * made on another device in between.
   */
  async updateFilters(
    chapterId: string,
    userId: string,
    filters: ChatSidebarFilters,
  ): Promise<ChatSidebarPreferences> {
    const payload: TablesInsert<'chat_sidebar_preferences'> = {
      ...filters,
      updated_at: new Date().toISOString(),
      // Server-owned keys last, so nothing spread above can override them.
      chapter_id: chapterId,
      user_id: userId,
    };
    const { data, error } = await this.supabase
      .from('chat_sidebar_preferences')
      .upsert(payload, { onConflict: 'user_id,chapter_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async setSectionCollapsed(
    chapterId: string,
    userId: string,
    sectionKey: string,
    collapsed: boolean,
  ): Promise<ChatSidebarPreferences> {
    const { data, error } = await this.supabase.rpc(
      'set_chat_sidebar_section_collapsed',
      {
        p_user_id: userId,
        p_chapter_id: chapterId,
        p_section_key: sectionKey,
        p_collapsed: collapsed,
      },
    );
    if (error) throw error;
    // The upsert always returns its row, so an empty result means the function
    // did not run as written; saying so beats returning `undefined` as a row.
    const row = data?.[0];
    if (!row) {
      throw new Error('set_chat_sidebar_section_collapsed returned no row');
    }
    return row;
  }

  async findPinnedChannelIds(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('chat_sidebar_pins')
      .select('channel_id')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId);
    if (error) throw error;
    return (data ?? []).map((row) => row.channel_id);
  }

  /**
   * `ignoreDuplicates`, so a repeat keeps the original `created_at` and a
   * double-tap or an offline retry is a no-op rather than a unique violation.
   */
  async pin(chapterId: string, userId: string, channelId: string) {
    const payload: TablesInsert<'chat_sidebar_pins'> = {
      chapter_id: chapterId,
      user_id: userId,
      channel_id: channelId,
    };
    const { error } = await this.supabase
      .from('chat_sidebar_pins')
      .upsert(payload, {
        onConflict: 'user_id,channel_id',
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  /**
   * Scoped by `chapter_id` too, although `(user_id, channel_id)` is already
   * unique: without it this method would reach into another chapter for any
   * caller that forgot to authorize the channel first.
   */
  async unpin(chapterId: string, userId: string, channelId: string) {
    const { error } = await this.supabase
      .from('chat_sidebar_pins')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('channel_id', channelId);
    if (error) throw error;
  }
}
