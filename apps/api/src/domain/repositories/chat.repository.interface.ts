import {
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  MessageReaction,
  ChannelReadReceipt,
} from '../entities/chat.entity';

export const CHAT_CHANNEL_REPOSITORY = 'CHAT_CHANNEL_REPOSITORY';
export const CHAT_CATEGORY_REPOSITORY = 'CHAT_CATEGORY_REPOSITORY';
export const CHAT_MESSAGE_REPOSITORY = 'CHAT_MESSAGE_REPOSITORY';
export const MESSAGE_REACTION_REPOSITORY = 'MESSAGE_REACTION_REPOSITORY';
export const CHANNEL_READ_RECEIPT_REPOSITORY =
  'CHANNEL_READ_RECEIPT_REPOSITORY';

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
  create(data: Partial<ChatChannelCategory>): Promise<ChatChannelCategory>;
  update(
    id: string,
    data: Partial<ChatChannelCategory>,
  ): Promise<ChatChannelCategory>;
  delete(id: string): Promise<void>;
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
  create(data: Partial<ChatMessage>): Promise<ChatMessage>;
  update(id: string, data: Partial<ChatMessage>): Promise<ChatMessage>;
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
