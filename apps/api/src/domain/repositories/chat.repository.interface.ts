import {
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  ChatMessageAction,
  MessageReaction,
  ChannelReadReceipt,
} from '../entities/chat.entity';

export const CHAT_CHANNEL_REPOSITORY = 'CHAT_CHANNEL_REPOSITORY';
export const CHAT_CATEGORY_REPOSITORY = 'CHAT_CATEGORY_REPOSITORY';
export const CHAT_MESSAGE_REPOSITORY = 'CHAT_MESSAGE_REPOSITORY';
export const CHAT_MESSAGE_ACTION_REPOSITORY = 'CHAT_MESSAGE_ACTION_REPOSITORY';
export const MESSAGE_REACTION_REPOSITORY = 'MESSAGE_REACTION_REPOSITORY';
export const CHANNEL_READ_RECEIPT_REPOSITORY =
  'CHANNEL_READ_RECEIPT_REPOSITORY';

/** Postgres unique-violation error code. */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Thrown by `IChatMessageRepository.create` when the partial unique index
 * `idx_chat_messages_dedupe` rejects the insert. Callers should re-select
 * the existing row via `findByClientMessageId` and return it as
 * `deduplicated: true`.
 */
export class ChatMessageDuplicateError extends Error {
  constructor(
    public readonly channel_id: string,
    public readonly sender_id: string,
    public readonly client_message_id: string,
  ) {
    super('Duplicate chat_messages insert (client_message_id collision)');
    this.name = 'ChatMessageDuplicateError';
  }
}

/**
 * Thrown by `IChatMessageActionRepository.create` when the unique dedupe
 * index `idx_chat_message_actions_dedupe` rejects the insert. Callers
 * decide whether to UPSERT (vote-change) or surface the existing row
 * as a no-op dedup.
 */
export class ChatMessageActionDuplicateError extends Error {
  constructor(
    public readonly message_id: string,
    public readonly user_id: string,
    public readonly action_type: string,
  ) {
    super('Duplicate chat_message_actions insert');
    this.name = 'ChatMessageActionDuplicateError';
  }
}

export interface IChatChannelRepository {
  findById(id: string, chapterId: string): Promise<ChatChannel | null>;
  findByChapter(chapterId: string): Promise<ChatChannel[]>;
  findDm(chapterId: string, memberIds: string[]): Promise<ChatChannel | null>;
  create(data: Partial<ChatChannel>): Promise<ChatChannel>;
  update(
    id: string,
    chapterId: string,
    data: Partial<ChatChannel>,
  ): Promise<ChatChannel>;
  delete(id: string, chapterId: string): Promise<void>;
}

export interface IChatCategoryRepository {
  findByChapter(chapterId: string): Promise<ChatChannelCategory[]>;
  findById(
    id: string,
    chapterId: string,
  ): Promise<ChatChannelCategory | null>;
  create(data: Partial<ChatChannelCategory>): Promise<ChatChannelCategory>;
  update(
    id: string,
    chapterId: string,
    data: Partial<ChatChannelCategory>,
  ): Promise<ChatChannelCategory>;
  delete(id: string, chapterId: string): Promise<void>;
}

export interface IChatMessageRepository {
  findById(id: string): Promise<ChatMessage | null>;
  findByChannel(
    channelId: string,
    options?: { limit?: number; before?: string },
  ): Promise<ChatMessage[]>;
  findPinnedByChannel(channelId: string): Promise<ChatMessage[]>;
  countPinnedByChannel(channelId: string): Promise<number>;
  /**
   * Newest-first list of POLL messages across every channel in the chapter.
   * Optional `channelId` scopes to a single channel. `limit` caps result size
   * (undefined, non-finite, or non-positive values use the shared list default;
   * finite positive values are clamped to the shared list min/max in the repo).
   * When `active` is set, expiration is enforced in SQL (via `metadata.expires_at`)
   * so `limit` applies after that filter, not before.
   */
  findPollsByChapter(
    chapterId: string,
    options?: { channelId?: string; limit?: number; active?: boolean },
  ): Promise<ChatMessage[]>;
  /**
   * Locate an already-persisted message by its idempotency triple. Used by
   * the hot-path send to reconcile a duplicate `(channel_id, sender_id,
   * client_message_id)` insert. Returns null when no such row exists.
   */
  findByClientMessageId(
    channelId: string,
    senderId: string,
    clientMessageId: string,
  ): Promise<ChatMessage | null>;
  /**
   * Insert a row. Throws {@link ChatMessageDuplicateError} on a
   * `(channel_id, sender_id, client_message_id)` unique violation so the
   * service can re-select and surface it as `deduplicated: true` instead
   * of a 5xx.
   */
  create(data: Partial<ChatMessage>): Promise<ChatMessage>;
  update(id: string, data: Partial<ChatMessage>): Promise<ChatMessage>;
}

export interface IChatMessageActionRepository {
  /**
   * Insert a per-user reaction / vote / RSVP row. Throws
   * {@link ChatMessageActionDuplicateError} on the unique index violation
   * so the caller can decide between dedup-as-success (emoji reactions)
   * and UPSERT (vote-change, ADR-07) without a read-then-insert race.
   */
  create(data: {
    message_id: string;
    user_id: string;
    action_type: string;
    payload?: Record<string, unknown>;
  }): Promise<ChatMessageAction>;
  findOne(
    messageId: string,
    userId: string,
    actionType: string,
  ): Promise<ChatMessageAction | null>;
  /**
   * Vote-change UPSERT (ADR-07): overwrite `payload` + bump `created_at`
   * on the row keyed by (message_id, user_id, action_type). The row id
   * stays stable so a subscribed client matches the Realtime UPDATE.
   */
  updateForVote(
    messageId: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<ChatMessageAction | null>;
}

export interface IMessageReactionRepository {
  findByMessage(messageId: string): Promise<MessageReaction[]>;
  findOne(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction | null>;
  create(data: Partial<MessageReaction>): Promise<MessageReaction>;
  delete(messageId: string, userId: string, emoji: string): Promise<void>;
}

export interface IChannelReadReceiptRepository {
  findByChannelAndUser(
    channelId: string,
    userId: string,
  ): Promise<ChannelReadReceipt | null>;
  upsert(
    channelId: string,
    userId: string,
    lastReadAt: string,
  ): Promise<ChannelReadReceipt>;
}
