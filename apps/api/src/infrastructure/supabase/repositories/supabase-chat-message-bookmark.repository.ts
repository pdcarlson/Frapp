import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChatMessageBookmarkRepository } from '../../../domain/repositories/chat.repository.interface';
import type {
  ChatMessageBookmark,
  ChatMessageBookmarkWithMessage,
} from '../../../domain/entities/chat.entity';
import { CHAT_MESSAGE_COLUMNS } from './supabase-chat-message.repository';

/**
 * The embed reuses the sibling repository's column list rather than restating
 * it.
 *
 * An earlier cut copied the string with a rationale that a flat comma list was
 * not usable inside a `message:chat_messages(...)` selector. That was simply
 * wrong — a flat comma list is exactly what a PostgREST embed takes — and the
 * copy was a real hazard, not a cosmetic one: the sibling constant carries the
 * standing instruction "adding a column to `chat_messages` means adding it here
 * too", and a second copy meant there were two "here"s with only one of them
 * saying so. A column renamed in a later migration and updated in one place
 * would have produced a PostgREST 400 on this endpoint in production while
 * every unit test stayed green.
 */
const BOOKMARK_WITH_MESSAGE_SELECT = `id, user_id, message_id, chapter_id, created_at, message:chat_messages!inner(${CHAT_MESSAGE_COLUMNS})`;

/**
 * How many bookmarks one list read returns, newest first.
 *
 * Bounded because the row count is entirely caller-controlled — a member can
 * bookmark every message they can see — and every row drags a full embedded
 * message including `payload`/`metadata` jsonb. `useBookmarks` fires on every
 * chat page view, so an unbounded query turns a member's own bookmarking into
 * an API memory and latency problem nothing else limits. The sibling message
 * read applies `DEFAULT_MESSAGE_LIMIT` for the same reason.
 *
 * Generous rather than tuned: the panel is a scroll list, not a paged one, and
 * 200 saved messages per chapter is well past what a member accumulates. If it
 * ever binds, the fix is a cursor, not a bigger number.
 */
export const BOOKMARK_LIST_LIMIT = 200;

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

  /**
   * Remove one of the caller's own bookmarks.
   *
   * Scoped by `chapter_id` as well as `(user_id, message_id)` even though that
   * pair is already globally unique. The pair being unique is what makes the
   * extra predicate look redundant, and it is exactly why it is here: without
   * it this method's safety depends entirely on its caller having authorized
   * the message first, and a future caller that skips that would delete across
   * chapters with a signature that gives no hint a chapter was involved.
   */
  async delete(
    userId: string,
    messageId: string,
    chapterId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_message_bookmarks')
      .delete()
      .eq('user_id', userId)
      .eq('message_id', messageId)
      .eq('chapter_id', chapterId);
    if (error) throw error;
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
   * `chat-bookmark.service.spec.ts` pins the service half; the integration spec
   * pins that this query actually returns the row.
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
      .order('created_at', { ascending: false })
      .limit(BOOKMARK_LIST_LIMIT);
    if (error) throw error;
    // PostgREST types an embed's rows as `T | GenericStringError`, which it
    // only ever is when `error` is set — already thrown above. The cast is to
    // the raw row shape, not to the entity, so `stripBookmarkRow` still has to
    // do the narrowing.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map(stripBookmarkRow);
  }
}

/**
 * Drops `user_id` on every exit from this repository, mirroring
 * `stripAttachmentRow` in the attachment repository.
 *
 * **This is a disclosure boundary, not tidiness.** `ChatBookmarkService`
 * returns these rows straight into the API response, and NestJS does not
 * serialize to the declared `@ApiOkResponse` DTO — there is no
 * `ClassSerializerInterceptor` registered anywhere in this app, so a DTO class
 * is OpenAPI documentation and nothing more. Without this, `user_id` shipped on
 * the wire despite `BookmarkDto` declaring it absent and the chat spec claiming
 * it was. `/diff-review` caught that; the DTO alone would never have.
 *
 * It is the caller's own id, so leaking it to them is not itself the breach —
 * the point is that "who bookmarked what" must never be a field a client can
 * read off this endpoint, because the day one is added for another viewer the
 * DTO will still say it is not there.
 */
function stripBookmarkRow(
  row: Record<string, unknown>,
): ChatMessageBookmarkWithMessage {
  // `delete` on a copy rather than a discarded destructuring binding, matching
  // `stripAttachmentRow` — an unused `_userId` binding is a lint error here.
  const rest = { ...row };
  delete (rest as { user_id?: unknown }).user_id;
  return rest as unknown as ChatMessageBookmarkWithMessage;
}
