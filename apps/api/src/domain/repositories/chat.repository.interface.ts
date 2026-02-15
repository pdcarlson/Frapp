import { ChatChannel, ChatMessage } from '../entities/chat.entity';

export const CHAT_REPOSITORY = 'CHAT_REPOSITORY';

export interface IChatRepository {
  // Channels
  createChannel(
    channel: Omit<ChatChannel, 'id' | 'createdAt'>,
  ): Promise<ChatChannel>;
  findChannelById(id: string): Promise<ChatChannel | null>;
  findChannelsByChapter(chapterId: string): Promise<ChatChannel[]>;

  // Messages
  createMessage(
    message: Omit<ChatMessage, 'id' | 'createdAt'>,
  ): Promise<ChatMessage>;
  findMessagesByChannel(
    channelId: string,
    limit?: number,
    offset?: number,
  ): Promise<ChatMessage[]>;
}
