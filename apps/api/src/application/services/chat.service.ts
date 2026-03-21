import * as path from 'path';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatCategoryRepository,
  IChatMessageRepository,
  IMessageReactionRepository,
  IChannelReadReceiptRepository,
} from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import type {
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  ChannelType,
} from '../../domain/entities/chat.entity';
import { NotificationService } from './notification.service';

const MAX_PINNED_MESSAGES = 50;
const MAX_GROUP_DM_MEMBERS = 10;
const CHAT_BUCKET = 'chat';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.csv',
]);

export interface CreateChannelInput {
  chapter_id: string;
  name: string;
  description?: string | null;
  type: ChannelType;
  required_permissions?: string[] | null;
  category_id?: string | null;
  is_read_only?: boolean;
}

export interface CreateDmInput {
  chapter_id: string;
  member_ids: string[];
}

export interface SendMessageInput {
  chapter_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  reply_to_id?: string | null;
  metadata?: Record<string, any>;
}

export interface CreateCategoryInput {
  chapter_id: string;
  name: string;
  display_order?: number;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(MESSAGE_REACTION_REPOSITORY)
    private readonly reactionRepo: IMessageReactionRepository,
    @Inject(CHANNEL_READ_RECEIPT_REPOSITORY)
    private readonly readReceiptRepo: IChannelReadReceiptRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly notificationService: NotificationService,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────

  async getChannels(chapterId: string): Promise<ChatChannel[]> {
    return this.channelRepo.findByChapter(chapterId);
  }

  async getChannel(id: string, chapterId: string): Promise<ChatChannel> {
    const channel = await this.channelRepo.findById(id, chapterId);
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async createChannel(input: CreateChannelInput): Promise<ChatChannel> {
    if (input.type === 'DM' || input.type === 'GROUP_DM') {
      throw new BadRequestException(
        'Use the DM endpoint to create direct messages',
      );
    }

    return this.channelRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      required_permissions: input.required_permissions ?? null,
      category_id: input.category_id ?? null,
      is_read_only: input.is_read_only ?? false,
    });
  }

  async updateChannel(
    id: string,
    chapterId: string,
    data: Partial<
      Pick<
        ChatChannel,
        | 'name'
        | 'description'
        | 'required_permissions'
        | 'category_id'
        | 'is_read_only'
      >
    >,
  ): Promise<ChatChannel> {
    await this.getChannel(id, chapterId);
    return this.channelRepo.update(id, chapterId, data);
  }

  async deleteChannel(id: string, chapterId: string): Promise<void> {
    await this.getChannel(id, chapterId);
    await this.channelRepo.delete(id, chapterId);
  }

  async getOrCreateDm(input: CreateDmInput): Promise<ChatChannel> {
    if (input.member_ids.length !== 2) {
      throw new BadRequestException('A DM requires exactly 2 members');
    }

    const existing = await this.channelRepo.findDm(
      input.chapter_id,
      input.member_ids,
    );
    if (existing) return existing;

    const sorted = [...input.member_ids].sort();
    return this.channelRepo.create({
      chapter_id: input.chapter_id,
      name: `dm-${sorted.join('-')}`,
      type: 'DM',
      member_ids: sorted,
    });
  }

  async createGroupDm(
    chapterId: string,
    memberIds: string[],
    name?: string,
  ): Promise<ChatChannel> {
    if (memberIds.length < 2 || memberIds.length > MAX_GROUP_DM_MEMBERS) {
      throw new BadRequestException(
        `Group DMs require 2 to ${MAX_GROUP_DM_MEMBERS} members`,
      );
    }

    return this.channelRepo.create({
      chapter_id: chapterId,
      name: name ?? `group-dm-${Date.now()}`,
      type: 'GROUP_DM',
      member_ids: memberIds,
    });
  }

  // ── Categories ───────────────────────────────────────────────────────

  async getCategories(chapterId: string): Promise<ChatChannelCategory[]> {
    return this.categoryRepo.findByChapter(chapterId);
  }

  async createCategory(
    input: CreateCategoryInput,
  ): Promise<ChatChannelCategory> {
    return this.categoryRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      display_order: input.display_order ?? 0,
    });
  }

  async updateCategory(
    id: string,
    data: { name?: string; display_order?: number },
  ): Promise<ChatChannelCategory> {
    return this.categoryRepo.update(id, data);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.categoryRepo.delete(id);
  }

  // ── Messages ─────────────────────────────────────────────────────────

  async getMessages(
    channelId: string,
    options?: { limit?: number; before?: string },
  ): Promise<ChatMessage[]> {
    return this.messageRepo.findByChannel(channelId, options);
  }

  async sendMessage(input: SendMessageInput): Promise<ChatMessage> {
    if (!input.content.trim()) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const channel = await this.validateChannelForChapter(
      input.channel_id,
      input.chapter_id,
    );

    const message = await this.messageRepo.create({
      channel_id: input.channel_id,
      sender_id: input.sender_id,
      content: input.content,
      type: 'TEXT',
      reply_to_id: input.reply_to_id ?? null,
      metadata: input.metadata ?? {},
    });

    try {
      await this.sendMessageNotification(input, channel);
    } catch (error) {
      this.logger.warn('Failed to send message notification', {
        messageId: message.id,
        channelId: input.channel_id,
        chapterId: input.chapter_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return message;
  }

  private async sendMessageNotification(
    input: SendMessageInput,
    channel: ChatChannel,
  ): Promise<void> {
    const isAnnouncement = channel.name.toLowerCase().includes('announcements');

    if (isAnnouncement) {
      await this.notificationService.notifyChapter(channel.chapter_id, {
        title: 'New Announcement',
        body: input.content.slice(0, 200),
        priority: 'URGENT',
        category: 'announcements',
        data: { target: { screen: 'chat', channelId: channel.id } },
      });
    } else if (channel.type === 'DM' || channel.type === 'GROUP_DM') {
      const recipientIds = (channel.member_ids ?? []).filter(
        (id) => id !== input.sender_id,
      );
      await Promise.allSettled(
        recipientIds.map((recipientId) =>
          this.notificationService.notifyUser(recipientId, channel.chapter_id, {
            title: 'New Message',
            body: input.content.slice(0, 200),
            priority: 'NORMAL',
            category: 'chat',
            data: { target: { screen: 'chat', channelId: channel.id } },
          }),
        ),
      );
    }
  }

  private async validateChannelForChapter(
    channelId: string,
    chapterId: string,
  ): Promise<ChatChannel> {
    const channel = await this.channelRepo.findById(channelId, chapterId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return channel;
  }

  async editMessage(
    messageId: string,
    senderId: string,
    content: string,
  ): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    if (message.sender_id !== senderId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    if (message.is_deleted) {
      throw new BadRequestException('Cannot edit a deleted message');
    }

    return this.messageRepo.update(messageId, {
      content,
      edited_at: new Date().toISOString(),
    });
  }

  async deleteMessage(
    messageId: string,
    requesterId: string,
    hasManagePermission: boolean,
  ): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    if (message.sender_id !== requesterId && !hasManagePermission) {
      throw new ForbiddenException(
        'You can only delete your own messages unless you have channels:manage permission',
      );
    }

    return this.messageRepo.update(messageId, {
      content: '[message deleted]',
      is_deleted: true,
      metadata: {},
    });
  }

  // ── Pins ─────────────────────────────────────────────────────────────

  async pinMessage(messageId: string): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    if (message.is_pinned) {
      throw new BadRequestException('Message is already pinned');
    }

    const pinnedCount = await this.messageRepo.countPinnedByChannel(
      message.channel_id,
    );
    if (pinnedCount >= MAX_PINNED_MESSAGES) {
      throw new BadRequestException(
        `Maximum of ${MAX_PINNED_MESSAGES} pinned messages per channel. Unpin an older message first.`,
      );
    }

    return this.messageRepo.update(messageId, {
      is_pinned: true,
      pinned_at: new Date().toISOString(),
    });
  }

  async unpinMessage(messageId: string): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    if (!message.is_pinned) {
      throw new BadRequestException('Message is not pinned');
    }

    return this.messageRepo.update(messageId, {
      is_pinned: false,
      pinned_at: null,
    });
  }

  async getPinnedMessages(channelId: string): Promise<ChatMessage[]> {
    return this.messageRepo.findPinnedByChannel(channelId);
  }

  // ── Reactions ────────────────────────────────────────────────────────

  async toggleReaction(messageId: string, userId: string, emoji: string) {
    const existing = await this.reactionRepo.findOne(messageId, userId, emoji);

    if (existing) {
      await this.reactionRepo.delete(messageId, userId, emoji);
      return { action: 'removed' as const };
    }

    const reaction = await this.reactionRepo.create({
      message_id: messageId,
      user_id: userId,
      emoji,
    });
    return { action: 'added' as const, reaction };
  }

  async getReactions(messageId: string) {
    return this.reactionRepo.findByMessage(messageId);
  }

  // ── Read Receipts ────────────────────────────────────────────────────

  async markChannelRead(channelId: string, userId: string) {
    return this.readReceiptRepo.upsert(
      channelId,
      userId,
      new Date().toISOString(),
    );
  }

  // ── File Upload ─────────────────────────────────────────────────────

  async requestChatUploadUrl(
    channelId: string,
    chapterId: string,
    filename: string,
    contentType: string,
  ) {
    const ext = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed`,
      );
    }

    const messageId = crypto.randomUUID();
    const storagePath = `chapters/${chapterId}/chat/${channelId}/${messageId}/${path.basename(filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      CHAT_BUCKET,
      storagePath,
      contentType,
    );

    return { signedUrl, storagePath, messageId };
  }
}
