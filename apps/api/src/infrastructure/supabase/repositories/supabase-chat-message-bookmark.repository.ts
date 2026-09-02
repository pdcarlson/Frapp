import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChatMessageBookmarkRepository } from '../../../domain/repositories/chat.repository.interface';
import type {
  ChatMessageBookmark,
  ChatMessageBookmarkWithMessage,
} from '../../../domain/entities/chat.entity';

/**
 * Columns of the joined message, mirroring `CHAT_MESSAGE_COLUMNS` in
 * `supabase-chat-message.repository.ts`.
 *
 * Restated rather than imported because the embed spells them inside a
 * PostgREST `message:chat_messages(...)` selector, where the sibling constant's
 * flat comma list is not directly usable. `content_search` and
 * `external_message_id` are excluded here for the same reason they are there:
 * no client reads them.
 */
const EMBEDDED_MESSAGE_COLUMNS =
  'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, type, kind, payload, client_message_id, reply_to_id, metadata, mentions, is_pinned, pinned_at, edited_at, is_deleted, created_at';

const BOOKMARK_WITH_MESSAGE_SELECT = `id, user_id, message_id, chapter_id, created_at, message:chat_messages!inner(${EMBEDDED_MESSAGE_COLUMNS})`;

/**
 * Personal message bookmarks (#462).
 *
 * Every query filters on `user_id`. That is the privacy boundary the spec asks
 * for — "no one else (not even channel admins) can see who bookmarked what" —
 * and it lives here rather than in RLS because the API reaches this table
 * through the service-role client, which bypasses RLS by design (the table
 * enables RLS with zero policies, so there is no client-reachable path at all).
 */
@Injectable()
export class SupabaseChatMessageBookmarkRepository implements IChatMessageBookmarkRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Idempotent by construction.
   *
   * `upsert` with `ignoreDuplicates: false` on the `(user_id, message_id)`
   * unique constraint returns the existing row on a repeat instead of raising
   * `PG_UNIQUE_VIOLATION`, so a double-tap or an offline retry is a no-op
   * rather than an error the caller must catch and translate. Note the update
   * branch rewrites the row to the same values — `created_at` is not in the
   * payload, so the original bookmark time survives a repeat.
   */
  async create(
    userId: string,
    messageId: string,
    chapterId: string,
  ): Promise<ChatMessageBookmark> {
    const payload: TablesInsert<'chat_message_bookmarks'> = {
      user_id: userId,
      message_id: messageId,
      chapter_id: chapterId,
    };
    const { data, error } = await this.supabase
      .from('chat_message_bookmarks')
      .upsert(payload, {
        onConflict: 'user_id,message_id',
        ignoreDuplicates: false,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async delete(userId: string, messageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_message_bookmarks')
      .delete()
      .eq('user_id', userId)
      .eq('message_id', messageId);
    if (error) throw error;
  }

  async findOne(
    userId: string,
    messageId: string,
  ): Promise<ChatMessageBookmark | null> {
    const { data, error } = await this.supabase
      .from('chat_message_bookmarks')
      .select('*')
      .eq('user_id', userId)
      .eq('message_id', messageId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * The caller's bookmarks in one chapter, newest bookmark first.
   *
   * **No `is_deleted` filter, deliberately.** The spec requires a bookmark
   * whose message was deleted to keep surfacing a "[message deleted]"
   * placeholder rather than vanish, and `ChatService.deleteMessage` already
   * rewrites the message's `content` to exactly that while keeping the row. So
   * the placeholder IS the joined message, and adding the filter that looks
   * like an obvious tidy-up here is precisely what would break the guarantee.
   * `chat-bookmarks.service.spec.ts` pins it.
   */
  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<ChatMessageBookmarkWithMessage[]> {
    const { data, error } = await this.supabase
      .from('chat_message_bookmarks')
      .select(BOOKMARK_WITH_MESSAGE_SELECT)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as ChatMessageBookmarkWithMessage[];
  }
}
