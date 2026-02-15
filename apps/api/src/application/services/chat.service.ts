import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CHAT_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatRepository } from '../../domain/repositories/chat.repository.interface';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';
import { ChatMessage, ChatChannel } from '../../domain/entities/chat.entity';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CHAT_REPOSITORY)
    private readonly chatRepo: IChatRepository,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
  ) {}

  async createChannel(data: {
    chapterId: string;
    name: string;
    description: string | null;
    type: 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED';
    allowedRoleIds?: string[];
  }): Promise<ChatChannel> {
    return this.chatRepo.createChannel({
      ...data,
      allowedRoleIds: data.allowedRoleIds || null,
    });
  }

  async getChannels(chapterId: string): Promise<ChatChannel[]> {
    return this.chatRepo.findChannelsByChapter(chapterId);
  }

  async sendMessage(
    senderId: string,
    chapterId: string,
    channelId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<ChatMessage> {
    const channel = await this.chatRepo.findChannelById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const message = await this.chatRepo.createMessage({
      channelId,
      senderId,
      content,
      metadata: metadata || null,
    });

    // Parse mentions (simplified: @uuid or similar)
    // In a real app, we'd regex for @name and lookup userIds
    // For now, let's assume we look for @[user_id]
    await this.handleMentions(content, chapterId, channel.name, senderId);

    return message;
  }

  async getMessages(
    channelId: string,
    limit?: number,
    offset?: number,
  ): Promise<ChatMessage[]> {
    return this.chatRepo.findMessagesByChannel(channelId, limit, offset);
  }

  private async handleMentions(
    content: string,
    chapterId: string,
    channelName: string,
    senderId: string,
  ) {
    // Regex to find @[uuid]
    const mentionRegex =
      /@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;
    const matches = content.matchAll(mentionRegex);
    const mentionedUserIds = Array.from(matches).map((m) => m[1]);

    if (mentionedUserIds.length > 0) {
      // De-duplicate
      const uniqueIds = [...new Set(mentionedUserIds)];

      for (const userId of uniqueIds) {
        if (userId === senderId) continue; // Don't notify self

        try {
          await this.notificationService.notifyUser(userId, chapterId, {
            title: `New mention in #${channelName}`,
            body: content.substring(0, 100),
            category: 'CHAT',
            data: { channelName, type: 'MENTION' },
          });
        } catch (error) {
          this.logger.error(`Failed to notify mentioned user ${userId}`, error);
        }
      }
    }
  }
}
