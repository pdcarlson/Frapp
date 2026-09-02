import { Inject, Injectable } from '@nestjs/common';
import { CHAT_MESSAGE_BOOKMARK_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageBookmarkRepository } from '../../domain/repositories/chat.repository.interface';
import type {
  ChatMessageBookmark,
  ChatMessageBookmarkWithMessage,
} from '../../domain/entities/chat.entity';
import { ChannelAccessService } from './channel-access.service';

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
   * `chapter_id` is taken from the resolved channel rather than the request
   * header, so a bookmark can never be filed under a chapter the message does
   * not belong to even if the two disagreed.
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
   * Still authorizes the message first. Skipping that would look harmless —
   * you can only delete your own row — but it would turn this route into an
   * existence oracle: a caller could probe arbitrary message uuids and
   * distinguish 404 from 204. Authorizing first means an unreachable message
   * answers 404 whether or not a bookmark exists.
   *
   * Deleting a bookmark that isn't there succeeds. There is no state to
   * reconcile and no information to leak either way, and an idempotent DELETE
   * is what makes the client's optimistic toggle safe to retry.
   */
  async unbookmarkMessage(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<void> {
    await this.channelAccess.assertMessageAccess(messageId, chapterId, userId);
    await this.bookmarkRepo.delete(userId, messageId);
  }

  /**
   * The caller's own bookmarks in this chapter, newest first, each with its
   * message.
   *
   * No channel re-authorization pass, deliberately: every row was authorized at
   * the moment it was created, and the alternative — re-filtering on read —
   * would silently drop a member's bookmarks when they leave a private channel,
   * which is a data-loss surprise rather than a protection. The rows are the
   * caller's own; the messages in them are ones they could see when they saved
   * them. If that trade ever needs revisiting it is a spec change, not a bug
   * fix.
   *
   * Deleted messages stay in the list carrying their `[message deleted]`
   * content, per the spec's placeholder rule.
   */
  async listBookmarks(
    chapterId: string,
    userId: string,
  ): Promise<ChatMessageBookmarkWithMessage[]> {
    return this.bookmarkRepo.findByUserAndChapter(userId, chapterId);
  }
}
