import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChatMessageBookmarkRepository } from '../../../domain/repositories/chat.repository.interface';
import type {
  ChatMessageBookmark,
  ChatMessageBookmarkWithMessage,
} from '../../../domain/entities/chat.entity';
/**
 * The message columns this endpoint serves — deliberately NOT
 * `CHAT_MESSAGE_COLUMNS`.
 *
 * Two earlier cuts got this wrong in opposite directions. The first copied the
 * sibling's 19-column list verbatim with a false rationale; the second imported
 * it, which fixed the duplication but kept serving all 19 columns against a
 * `BookmarkedMessageDto` that calls itself "a narrow projection" and declares
 * nine. That gap was a real disclosure, not a documentation nit:
 * `ChatService.deleteMessage` blanks `content` and `metadata` but **not**
 * `payload`, so a bookmarked poll or event card that had since been deleted
 * shipped its full payload jsonb on an endpoint whose declared type says the
 * message reads `[message deleted]`.
 *
 * So the projection is the DTO's field list, spelled here, and the two must
 * stay in step. It is a genuinely different list from the sibling's — the
 * timeline needs `payload`, `mentions` and `reply_to_id` to render a card; a
 * bookmark row renders an author, a timestamp and a text preview, and jumps.
 * Narrowing also makes the rows small, which is what lets this endpoint stay
 * unpaginated for now.
 */
const BOOKMARK_MESSAGE_COLUMNS =
  'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, is_deleted, created_at';

const BOOKMARK_WITH_MESSAGE_SELECT = `id, user_id, message_id, chapter_id, created_at, message:chat_messages!inner(${BOOKMARK_MESSAGE_COLUMNS})`;

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
    // Stripped here too, so "every exit from this repository" is literally
    // true. `create`'s row is the caller's own, so this is not a breach — but
    // `BookmarkRefDto` declares the field absent, and a response that quietly
    // carries a column its declared shape omits is how the list endpoint's leak
    // happened in the first place.
    return stripBookmarkRow<ChatMessageBookmark>(data);
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
   *
   * **Unpaginated, deliberately, and this is a trade rather than an oversight.**
   * A cap was added and then removed: the web client derives each message's
   * bookmark chip state from this list, so a truncated list makes bookmark
   * N+1 render "Save" forever — and because the write is an idempotent upsert,
   * re-saving it is a no-op, so the member can never toggle it off. A silent
   * correctness cliff at a fixed row count is worse than an unbounded read of
   * rows this narrow, and the row count is self-inflicted rather than
   * adversarial (a member can only bookmark messages they can see). #1567
   * tracks paginating this properly alongside a per-page bookmark-state
   * lookup, which is the shape that fixes both at once.
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
    // PostgREST types an embed's rows as `T | GenericStringError`, which it
    // only ever is when `error` is set — already thrown above. The cast is to
    // the raw row shape, not to the entity, so `stripBookmarkRow` still has to
    // do the narrowing.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) =>
      stripBookmarkRow<ChatMessageBookmarkWithMessage>(row),
    );
  }
}

/**
 * Drops `user_id` on every exit from this repository, mirroring
 * `stripAttachmentRow` in the attachment repository — which applies it on
 * EVERY exit, not only the read, for exactly the reason repeated here.
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
function stripBookmarkRow<T>(row: Record<string, unknown>): T {
  // `delete` on a copy rather than a discarded destructuring binding, matching
  // `stripAttachmentRow` — an unused `_userId` binding is a lint error here.
  const rest = { ...row };
  delete (rest as { user_id?: unknown }).user_id;
  return rest as unknown as T;
}
