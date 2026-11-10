import type {
  ChatMessage,
  ChatThreadFollow,
  ChatThreadFollowState,
  FollowedThreadUnread,
} from '../entities/chat.entity';

export const CHAT_THREAD_REPOSITORY = 'CHAT_THREAD_REPOSITORY';

/**
 * Message threads (#3785): a thread's replies and who follows it.
 *
 * Nothing here authorizes. Every caller has already resolved the root through
 * the channel-access lookup, so a root id that reaches this repository is one
 * the caller may read.
 */
export interface IChatThreadRepository {
  /**
   * A thread's replies, newest first under `limit`, paged like the timeline:
   * `before` is an instant, `since` a reply id in the same thread (throws
   * `ChatMessageCursorNotFoundError` when it is not one).
   */
  findReplies(
    rootId: string,
    options: { limit: number; before?: string; since?: string },
  ): Promise<ChatMessage[]>;

  /** The member's follow row for a thread, or `null` when not following. */
  findFollow(rootId: string, userId: string): Promise<ChatThreadFollow | null>;

  /** The follow state of each listed member who has a row; others are absent. */
  findFollowStates(
    rootId: string,
    userIds: string[],
  ): Promise<Map<string, ChatThreadFollowState>>;

  /**
   * Auto-follow: adds a `following` row for each member who has none. An
   * existing row, a `muted` one above all, is left as it is, so a mention or a
   * reply never undoes a mute.
   */
  ensureFollowing(
    rootId: string,
    channelId: string,
    userIds: string[],
  ): Promise<void>;

  /** Sets the member's state, creating the row; `null` deletes it (unfollow). */
  setFollowState(
    rootId: string,
    channelId: string,
    userId: string,
    state: ChatThreadFollowState | null,
  ): Promise<void>;

  /**
   * Moves the member's read cursor to `readAt`, creating a `following` row
   * when they have none: opening a thread to read it is interest in it.
   * Never moves the cursor backwards.
   */
  markRead(
    rootId: string,
    channelId: string,
    userId: string,
    readAt: string,
  ): Promise<void>;

  /** The member's followed and muted threads in a channel, with new-reply counts. */
  findFollowedUnread(
    channelId: string,
    userId: string,
  ): Promise<FollowedThreadUnread[]>;
}
