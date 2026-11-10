import type {
  ChatMessage,
  ChatThreadFollow,
  ChatThreadFollowRowState,
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

  /**
   * Every member with a row for this thread and their stored state. Read by
   * the thread, not by a member list: a thread has few rows, while the push
   * audience can be a whole chapter, past what one `in` filter's URL holds.
   */
  findFollowStates(
    rootId: string,
  ): Promise<Map<string, ChatThreadFollowRowState>>;

  /**
   * Auto-follow: adds a `following` row for each member who has none. An
   * existing row is left as it is, so a mention or someone else's reply never
   * undoes a mute or an unfollow.
   */
  ensureFollowing(
    rootId: string,
    channelId: string,
    userIds: string[],
  ): Promise<void>;

  /**
   * The member's own reply: follow, creating the row, and turn an
   * `unfollowed` row back to `following`. A mute is kept.
   */
  followOnReply(
    rootId: string,
    channelId: string,
    userId: string,
  ): Promise<void>;

  /**
   * Sets the member's state, creating the row. `null` unfollows: the row is
   * kept as `unfollowed`, so its read cursor survives and auto-follow cannot
   * re-add it.
   */
  setFollowState(
    rootId: string,
    channelId: string,
    userId: string,
    state: ChatThreadFollowState | null,
  ): Promise<void>;

  /**
   * Moves the member's read cursor to `readAt`, creating an `unfollowed` row
   * when they have none: reading a thread is not following it. Never moves the
   * cursor backwards, and never changes the state.
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
