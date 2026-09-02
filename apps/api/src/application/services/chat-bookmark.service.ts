import { Inject, Injectable } from '@nestjs/common';
import { CHAT_MESSAGE_BOOKMARK_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageBookmarkRepository } from '../../domain/repositories/chat.repository.interface';
import type {
  ChatMessageBookmark,
  ChatMessageBookmarkWithMessage,
} from '../../domain/entities/chat.entity';
import { ChannelAccessService } from './channel-access.service';

/**
 * What a bookmark looks like once its channel is no longer readable.
 *
 * The row stays — the member saved it, and it is their row — but every field
 * that could carry content, identity, or *subsequent activity* is replaced.
 * That last category is the one worth being explicit about: an earlier cut
 * blanked the content but left `is_pinned`, `pinned_at`, `edited_at`, `kind`
 * and `reply_to_id` intact, which meant a member who had lost access could
 * still watch the message get pinned or edited. Redacting the body while
 * leaving a live activity side-channel is not redaction.
 *
 * Two fields deliberately survive:
 *
 * - `channel_id`, because it is not new information — the member chose to save
 *   from that channel and already knew which one it was.
 * - `created_at`, for the same reason: it is immutable and was visible when
 *   they saved. Nothing about it changes after revocation, so it carries no
 *   post-revocation signal.
 */
export const BOOKMARK_REDACTED_CONTENT =
  '[unavailable — you no longer have access to this channel]';

function redactBookmarkedMessage(
  bookmark: ChatMessageBookmarkWithMessage,
): ChatMessageBookmarkWithMessage {
  return {
    ...bookmark,
    message_available: false,
    message: {
      ...bookmark.message,
      sender_id: null,
      author_name: null,
      author_avatar_path: null,
      author_external_id: null,
      content: BOOKMARK_REDACTED_CONTENT,
      type: 'TEXT',
      kind: 'text',
      payload: null,
      metadata: {},
      mentions: [],
      reply_to_id: null,
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
    },
  };
}

/**
 * Personal message bookmarks (#462), per `spec/behavior/chat/README.md`
 * § Bookmarks (personal).
 *
 * **Its own service rather than more of `ChatService`.** `ChatService` is
 * already 1,370 lines across five concerns and #1380 is open to split it;
 * adding a sixth would make that issue harder rather than easier. Bookmarks
 * share nothing with the chat hot path but the authorization seam, and that
 * seam is `ChannelAccessService`, which both use.
 *
 * **The privacy guarantee, stated once here because it is the whole design:**
 * the spec says no one — not even a channel admin — can see who bookmarked
 * what. Three things hold that up, and none of them is a permission check:
 *
 * 1. No route or method accepts a caller-supplied user id. The owner is always
 *    `@CurrentUser('id')`, so there is no parameter to escalate through.
 * 2. Every repository query filters on that id, and the repository interface
 *    deliberately offers no by-message or count-for-message method — there is
 *    no way to ask a question about someone else's bookmarks.
 * 3. The table enables RLS with zero policies, so there is no client-reachable
 *    read path at all.
 *
 * Note what is absent: `channels:manage` grants nothing here. A moderator can
 * pin, delete and moderate a message and still cannot learn that anyone
 * bookmarked it. That asymmetry with pin is the point of the feature.
 */
@Injectable()
export class ChatBookmarkService {
  constructor(
    @Inject(CHAT_MESSAGE_BOOKMARK_REPOSITORY)
    private readonly bookmarkRepo: IChatMessageBookmarkRepository,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * Bookmark a message the caller can see.
   *
   * Authorizes with the shared message seam at `'read'`: bookmarking is a
   * private note-to-self, not authored channel content, so it is correct that a
   * member may bookmark in a read-only channel (#announcements) they can read
   * but not post to. `'post'` here would deny exactly the messages members most
   * want to keep.
   *
   * `chapter_id` is the **request's** chapter (`x-chapter-id`, via
   * `@CurrentChapterId()`), not a value read off the resolved channel — an
   * earlier version of this comment said the opposite and was wrong. The
   * invariant still holds, but by a different mechanism, and the difference
   * matters to anyone adding a second write path: `assertMessageAccess`
   * resolves the channel with `channelRepo.findById(channelId, chapterId)`,
   * which is itself chapter-scoped, so a message outside this chapter 404s
   * before we ever reach the insert. The guarantee is that downstream check,
   * not a structural derivation. A future write path that authorizes some other
   * way must re-establish it rather than assume it.
   */
  async bookmarkMessage(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatMessageBookmark> {
    await this.channelAccess.assertMessageAccess(messageId, chapterId, userId);
    return this.bookmarkRepo.create(userId, messageId, chapterId);
  }

  /**
   * Remove the caller's own bookmark.
   *
   * **Deliberately does NOT authorize the message.** An earlier cut did, on
   * anti-oracle grounds, and that was a mistake in both directions.
   *
   * It broke a real case. Losing access to a channel does not delete your
   * bookmarks — by design, per `listBookmarks` — so authorizing the message
   * here meant that the moment Bob rotated off exec, `DELETE` on his own
   * `#exec` bookmark answered **403**. The row stayed in his panel, redacted,
   * unjumpable, and now permanently undeletable, with no path in the API or
   * the UI to clear it. A member must always be able to remove their own row.
   *
   * And it did not buy the protection it was there for. This route is
   * unconditionally idempotent: deleting a bookmark that is not there succeeds
   * exactly like deleting one that is, so the response cannot distinguish the
   * two whether or not the message is authorized. The assert added a 403-vs-204
   * split keyed on *channel access* — which is to say it created an oracle
   * rather than closing one.
   *
   * What keeps it safe is the scoping instead: the delete matches on
   * `(user_id, message_id, chapter_id)`, so a caller can only ever remove their
   * own row in their own chapter, and every outcome is 204.
   */
  async unbookmarkMessage(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<void> {
    await this.bookmarkRepo.delete(userId, messageId, chapterId);
  }

  /**
   * The caller's own bookmarks in this chapter, newest first, each with its
   * message.
   *
   * **Channel access is re-checked on every read, and this is not optional.**
   * An earlier cut of this method skipped it, reasoning that each row was
   * authorized when it was created and that re-filtering would silently drop a
   * member's saved messages when they left a private channel. The second half
   * of that is a fair concern; the first half is simply wrong, and `/diff-review`
   * caught it. The embed re-reads `chat_messages` on **every request**, so what
   * comes back is the message's *current* content, not a snapshot taken at save
   * time. A member who bookmarked a message in `#exec`, then lost the role, kept
   * receiving that message — including edits made after they lost access. Losing
   * a permission has to revoke the read, and it did not.
   *
   * The fix keeps both properties instead of trading one away: the bookmark row
   * always survives, and the message is **redacted** when its channel is no
   * longer readable. The member still sees that they saved something and can
   * still unsave it; they just stop receiving its content. That is why this
   * redacts rather than filtering rows out, which is what
   * {@link ChannelAccessService.filterAccessibleChannelIds} does for
   * `SearchService` — search has no row of the caller's own to preserve.
   *
   * Deleted messages are a different case and stay verbatim: `deleteMessage`
   * already rewrote `content` to `[message deleted]`, which is the placeholder
   * the spec asks for.
   */
  async listBookmarks(
    chapterId: string,
    userId: string,
  ): Promise<ChatMessageBookmarkWithMessage[]> {
    const bookmarks = await this.bookmarkRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (bookmarks.length === 0) return [];

    const accessible = await this.channelAccess.filterAccessibleChannelIds(
      chapterId,
      userId,
      // De-duplicated: a member with 40 bookmarks in one channel must not make
      // the predicate resolve that channel 40 times.
      [...new Set(bookmarks.map((b) => b.message.channel_id))],
      // An archived Group DM (#348) is still readable by whoever remains in it
      // — only posting is frozen. Without this the archive would read as a
      // revocation and redact messages the member can still open in the
      // timeline, which is a worse lie than the leak this pass is fixing.
      { includeArchived: true },
    );

    return bookmarks.map((bookmark) =>
      accessible.has(bookmark.message.channel_id)
        ? { ...bookmark, message_available: true }
        : redactBookmarkedMessage(bookmark),
    );
  }
}
