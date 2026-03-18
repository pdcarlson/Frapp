import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from '../../application/services/chat.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ExecutionContext } from '@nestjs/common';
import { ChannelType } from '../../domain/entities/chat.entity';
import {
  CreateChannelDto,
  UpdateChannelDto,
  CreateDmDto,
  CreateGroupDmDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  SendMessageDto,
  EditMessageDto,
  ReactionDto,
  RequestChatUploadUrlDto,
} from '../dtos/chat.dto';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: jest.Mocked<ChatService>;

  const mockChatService = {
    getChannels: jest.fn(),
    getChannel: jest.fn(),
    createChannel: jest.fn(),
    updateChannel: jest.fn(),
    deleteChannel: jest.fn(),
    getOrCreateDm: jest.fn(),
    createGroupDm: jest.fn(),
    getCategories: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    deleteCategory: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    editMessage: jest.fn(),
    deleteMessage: jest.fn(),
    getPinnedMessages: jest.fn(),
    pinMessage: jest.fn(),
    unpinMessage: jest.fn(),
    toggleReaction: jest.fn(),
    getReactions: jest.fn(),
    requestChatUploadUrl: jest.fn(),
    markChannelRead: jest.fn(),
  };

  const mockSupabaseAuthGuard = {
    canActivate: jest.fn((context: ExecutionContext) => true),
  };

  const mockChapterGuard = {
    canActivate: jest.fn((context: ExecutionContext) => true),
  };

  const mockPermissionsGuard = {
    canActivate: jest.fn((context: ExecutionContext) => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue(mockSupabaseAuthGuard)
      .overrideGuard(ChapterGuard)
      .useValue(mockChapterGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(mockPermissionsGuard)
      .compile();

    controller = module.get<ChatController>(ChatController);
    chatService = module.get(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── Channels ─────────────────────────────────────────────────────────

  describe('listChannels', () => {
    it('should list channels for a chapter', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = [{ id: 'channel-1' }];
      chatService.getChannels.mockResolvedValue(expectedResult as any);

      const result = await controller.listChannels(chapterId);

      expect(chatService.getChannels).toHaveBeenCalledWith(chapterId);
      expect(result).toBe(expectedResult);
    });
  });

  describe('getChannel', () => {
    it('should get a specific channel', async () => {
      const chapterId = 'chapter-1';
      const channelId = 'channel-1';
      const expectedResult = { id: channelId };
      chatService.getChannel.mockResolvedValue(expectedResult as any);

      const result = await controller.getChannel(chapterId, channelId);

      expect(chatService.getChannel).toHaveBeenCalledWith(channelId, chapterId);
      expect(result).toBe(expectedResult);
    });
  });

  describe('createChannel', () => {
    it('should create a new channel', async () => {
      const chapterId = 'chapter-1';
      const dto: CreateChannelDto = {
        name: 'general',
        description: 'General discussion',
        type: 'text',
        is_read_only: false,
      };
      const expectedResult = { id: 'channel-1', ...dto };
      chatService.createChannel.mockResolvedValue(expectedResult as any);

      const result = await controller.createChannel(chapterId, dto);

      expect(chatService.createChannel).toHaveBeenCalledWith({
        chapter_id: chapterId,
        name: dto.name,
        description: dto.description,
        type: dto.type as ChannelType,
        required_permissions: dto.required_permissions,
        category_id: dto.category_id,
        is_read_only: dto.is_read_only,
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('updateChannel', () => {
    it('should update an existing channel', async () => {
      const chapterId = 'chapter-1';
      const channelId = 'channel-1';
      const dto: UpdateChannelDto = {
        name: 'new-name',
      };
      const expectedResult = { id: channelId, ...dto };
      chatService.updateChannel.mockResolvedValue(expectedResult as any);

      const result = await controller.updateChannel(chapterId, channelId, dto);

      expect(chatService.updateChannel).toHaveBeenCalledWith(
        channelId,
        chapterId,
        dto,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('deleteChannel', () => {
    it('should delete a channel', async () => {
      const chapterId = 'chapter-1';
      const channelId = 'channel-1';
      chatService.deleteChannel.mockResolvedValue(undefined);

      const result = await controller.deleteChannel(chapterId, channelId);

      expect(chatService.deleteChannel).toHaveBeenCalledWith(
        channelId,
        chapterId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('getOrCreateDm', () => {
    it('should get or create a DM channel', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: CreateDmDto = {
        member_id: 'user-2',
      };
      const expectedResult = { id: 'dm-1' };
      chatService.getOrCreateDm.mockResolvedValue(expectedResult as any);

      const result = await controller.getOrCreateDm(chapterId, userId, dto);

      expect(chatService.getOrCreateDm).toHaveBeenCalledWith({
        chapter_id: chapterId,
        member_ids: [userId, dto.member_id],
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('createGroupDm', () => {
    it('should create a group DM channel', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: CreateGroupDmDto = {
        member_ids: ['user-2', 'user-3', 'user-2'], // includes duplicate
        name: 'Group Chat',
      };
      const expectedResult = { id: 'group-dm-1' };
      chatService.createGroupDm.mockResolvedValue(expectedResult as any);

      const result = await controller.createGroupDm(chapterId, userId, dto);

      // Verify duplicates are removed and userId is included
      expect(chatService.createGroupDm).toHaveBeenCalledWith(
        chapterId,
        ['user-1', 'user-2', 'user-3'],
        dto.name,
      );
      expect(result).toBe(expectedResult);
    });
  });

  // ── Categories ───────────────────────────────────────────────────────

  describe('listCategories', () => {
    it('should list categories for a chapter', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = [{ id: 'category-1' }];
      chatService.getCategories.mockResolvedValue(expectedResult as any);

      const result = await controller.listCategories(chapterId);

      expect(chatService.getCategories).toHaveBeenCalledWith(chapterId);
      expect(result).toBe(expectedResult);
    });
  });

  describe('createCategory', () => {
    it('should create a new category', async () => {
      const chapterId = 'chapter-1';
      const dto: CreateCategoryDto = {
        name: 'Important',
        display_order: 1,
      };
      const expectedResult = { id: 'category-1', ...dto };
      chatService.createCategory.mockResolvedValue(expectedResult as any);

      const result = await controller.createCategory(chapterId, dto);

      expect(chatService.createCategory).toHaveBeenCalledWith({
        chapter_id: chapterId,
        name: dto.name,
        display_order: dto.display_order,
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('updateCategory', () => {
    it('should update an existing category', async () => {
      const categoryId = 'category-1';
      const dto: UpdateCategoryDto = {
        name: 'Less Important',
      };
      const expectedResult = { id: categoryId, ...dto };
      chatService.updateCategory.mockResolvedValue(expectedResult as any);

      const result = await controller.updateCategory(categoryId, dto);

      expect(chatService.updateCategory).toHaveBeenCalledWith(categoryId, dto);
      expect(result).toBe(expectedResult);
    });
  });

  describe('deleteCategory', () => {
    it('should delete a category', async () => {
      const categoryId = 'category-1';
      chatService.deleteCategory.mockResolvedValue(undefined);

      const result = await controller.deleteCategory(categoryId);

      expect(chatService.deleteCategory).toHaveBeenCalledWith(categoryId);
      expect(result).toEqual({ success: true });
    });
  });

  // ── Messages ─────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should get messages with limit and cursor', async () => {
      const channelId = 'channel-1';
      const limit = 20;
      const before = '2023-01-01T00:00:00.000Z';
      const expectedResult = { data: [], hasMore: false };
      chatService.getMessages.mockResolvedValue(expectedResult as any);

      const result = await controller.getMessages(channelId, limit, before);

      expect(chatService.getMessages).toHaveBeenCalledWith(channelId, {
        limit,
        before,
      });
      expect(result).toBe(expectedResult);
    });

    it('should get messages without limit and cursor', async () => {
      const channelId = 'channel-1';
      const expectedResult = { data: [], hasMore: false };
      chatService.getMessages.mockResolvedValue(expectedResult as any);

      const result = await controller.getMessages(channelId, undefined, undefined);

      expect(chatService.getMessages).toHaveBeenCalledWith(channelId, {
        limit: undefined,
        before: undefined,
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('sendMessage', () => {
    it('should send a message', async () => {
      const channelId = 'channel-1';
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: SendMessageDto = {
        content: 'Hello world',
        reply_to_id: 'msg-1',
        metadata: { key: 'value' },
      };
      const expectedResult = { id: 'msg-2' };
      chatService.sendMessage.mockResolvedValue(expectedResult as any);

      const result = await controller.sendMessage(
        channelId,
        chapterId,
        userId,
        dto,
      );

      expect(chatService.sendMessage).toHaveBeenCalledWith({
        chapter_id: chapterId,
        channel_id: channelId,
        sender_id: userId,
        content: dto.content,
        reply_to_id: dto.reply_to_id,
        metadata: dto.metadata,
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('editMessage', () => {
    it('should edit a message', async () => {
      const messageId = 'msg-1';
      const userId = 'user-1';
      const dto: EditMessageDto = {
        content: 'Edited text',
      };
      const expectedResult = { id: messageId, content: dto.content };
      chatService.editMessage.mockResolvedValue(expectedResult as any);

      const result = await controller.editMessage(messageId, userId, dto);

      expect(chatService.editMessage).toHaveBeenCalledWith(
        messageId,
        userId,
        dto.content,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('deleteMessage', () => {
    it('should soft delete a message', async () => {
      const messageId = 'msg-1';
      const userId = 'user-1';
      const expectedResult = { id: messageId, is_deleted: true };
      chatService.deleteMessage.mockResolvedValue(expectedResult as any);

      const result = await controller.deleteMessage(messageId, userId);

      expect(chatService.deleteMessage).toHaveBeenCalledWith(
        messageId,
        userId,
        false, // hardDelete = false
      );
      expect(result).toBe(expectedResult);
    });
  });

  // ── Pins ─────────────────────────────────────────────────────────────

  describe('getPinnedMessages', () => {
    it('should get pinned messages', async () => {
      const channelId = 'channel-1';
      const expectedResult = [{ id: 'msg-1' }];
      chatService.getPinnedMessages.mockResolvedValue(expectedResult as any);

      const result = await controller.getPinnedMessages(channelId);

      expect(chatService.getPinnedMessages).toHaveBeenCalledWith(channelId);
      expect(result).toBe(expectedResult);
    });
  });

  describe('pinMessage', () => {
    it('should pin a message', async () => {
      const messageId = 'msg-1';
      const expectedResult = { id: messageId, is_pinned: true };
      chatService.pinMessage.mockResolvedValue(expectedResult as any);

      const result = await controller.pinMessage(messageId);

      expect(chatService.pinMessage).toHaveBeenCalledWith(messageId);
      expect(result).toBe(expectedResult);
    });
  });

  describe('unpinMessage', () => {
    it('should unpin a message', async () => {
      const messageId = 'msg-1';
      const expectedResult = { id: messageId, is_pinned: false };
      chatService.unpinMessage.mockResolvedValue(expectedResult as any);

      const result = await controller.unpinMessage(messageId);

      expect(chatService.unpinMessage).toHaveBeenCalledWith(messageId);
      expect(result).toBe(expectedResult);
    });
  });

  // ── Reactions ────────────────────────────────────────────────────────

  describe('toggleReaction', () => {
    it('should toggle a reaction', async () => {
      const messageId = 'msg-1';
      const userId = 'user-1';
      const dto: ReactionDto = { emoji: '👍' };
      const expectedResult = { added: true };
      chatService.toggleReaction.mockResolvedValue(expectedResult as any);

      const result = await controller.toggleReaction(messageId, userId, dto);

      expect(chatService.toggleReaction).toHaveBeenCalledWith(
        messageId,
        userId,
        dto.emoji,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('getReactions', () => {
    it('should get reactions for a message', async () => {
      const messageId = 'msg-1';
      const expectedResult = [{ emoji: '👍', count: 1 }];
      chatService.getReactions.mockResolvedValue(expectedResult as any);

      const result = await controller.getReactions(messageId);

      expect(chatService.getReactions).toHaveBeenCalledWith(messageId);
      expect(result).toBe(expectedResult);
    });
  });

  // ── File Upload ────────────────────────────────────────────────────

  describe('requestUploadUrl', () => {
    it('should request an upload URL', async () => {
      const channelId = 'channel-1';
      const chapterId = 'chapter-1';
      const dto: RequestChatUploadUrlDto = {
        filename: 'image.png',
        content_type: 'image/png',
      };
      const expectedResult = { uploadUrl: 'http://example.com/upload' };
      chatService.requestChatUploadUrl.mockResolvedValue(expectedResult as any);

      const result = await controller.requestUploadUrl(channelId, chapterId, dto);

      expect(chatService.requestChatUploadUrl).toHaveBeenCalledWith(
        channelId,
        chapterId,
        dto.filename,
        dto.content_type,
      );
      expect(result).toBe(expectedResult);
    });
  });

  // ── Read Receipts ────────────────────────────────────────────────────

  describe('markRead', () => {
    it('should mark channel as read', async () => {
      const channelId = 'channel-1';
      const userId = 'user-1';
      const expectedResult = { success: true };
      chatService.markChannelRead.mockResolvedValue(expectedResult as any);

      const result = await controller.markRead(channelId, userId);

      expect(chatService.markChannelRead).toHaveBeenCalledWith(channelId, userId);
      expect(result).toBe(expectedResult);
    });
  });
});
