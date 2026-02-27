import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
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
  ChatMessage,
  ChatChannelCategory,
  MessageReaction,
} from '../../domain/entities/chat.entity';
import { NotificationService } from './notification.service';

describe('ChatService', () => {
  let service: ChatService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockCategoryRepo: jest.Mocked<IChatCategoryRepository>;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockReactionRepo: jest.Mocked<IMessageReactionRepository>;
  let mockReadReceiptRepo: jest.Mocked<IChannelReadReceiptRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;
  let mockNotificationService: jest.Mocked<Pick<NotificationService, 'notifyUser' | 'notifyChapter'>>;

  const baseChannel: ChatChannel = {
    id: 'ch-chan-1',
    chapter_id: 'ch-1',
    name: 'general',
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    member_ids: null,
    category_id: null,
    is_read_only: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const baseMessage: ChatMessage = {
    id: 'msg-1',
    channel_id: 'ch-chan-1',
    sender_id: 'user-1',
    content: 'Hello world',
    type: 'TEXT',
    reply_to_id: null,
    metadata: {},
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-01-01T12:00:00.000Z',
  };

  beforeEach(async () => {
    mockChannelRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findDm: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockCategoryRepo = {
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockMessageRepo = {
      findById: jest.fn(),
      findByChannel: jest.fn(),
      findPinnedByChannel: jest.fn(),
      countPinnedByChannel: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockReactionRepo = {
      findByMessage: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };

    mockReadReceiptRepo = {
      findByChannelAndUser: jest.fn(),
      upsert: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      deleteFile: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
        { provide: CHAT_CATEGORY_REPOSITORY, useValue: mockCategoryRepo },
        { provide: CHAT_MESSAGE_REPOSITORY, useValue: mockMessageRepo },
        { provide: MESSAGE_REACTION_REPOSITORY, useValue: mockReactionRepo },
        {
          provide: CHANNEL_READ_RECEIPT_REPOSITORY,
          useValue: mockReadReceiptRepo,
        },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  // ── Channels ─────────────────────────────────────────────────────────

  describe('createChannel', () => {
    it('should create a PUBLIC channel', async () => {
      mockChannelRepo.create.mockResolvedValue(baseChannel);

      const result = await service.createChannel({
        chapter_id: 'ch-1',
        name: 'general',
        type: 'PUBLIC',
      });

      expect(result).toEqual(baseChannel);
      expect(mockChannelRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          name: 'general',
          type: 'PUBLIC',
        }),
      );
    });

    it('should reject DM/GROUP_DM through createChannel', async () => {
      await expect(
        service.createChannel({
          chapter_id: 'ch-1',
          name: 'dm',
          type: 'DM',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrCreateDm', () => {
    it('should return existing DM if found', async () => {
      const dmChannel = {
        ...baseChannel,
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findDm.mockResolvedValue(dmChannel);

      const result = await service.getOrCreateDm({
        chapter_id: 'ch-1',
        member_ids: ['user-1', 'user-2'],
      });

      expect(result).toEqual(dmChannel);
      expect(mockChannelRepo.create).not.toHaveBeenCalled();
    });

    it('should create a new DM if not found', async () => {
      const dmChannel = {
        ...baseChannel,
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findDm.mockResolvedValue(null);
      mockChannelRepo.create.mockResolvedValue(dmChannel);

      const result = await service.getOrCreateDm({
        chapter_id: 'ch-1',
        member_ids: ['user-1', 'user-2'],
      });

      expect(mockChannelRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DM' }),
      );
      expect(result.type).toBe('DM');
    });

    it('should reject DM with wrong member count', async () => {
      await expect(
        service.getOrCreateDm({
          chapter_id: 'ch-1',
          member_ids: ['user-1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createGroupDm', () => {
    it('should create a group DM', async () => {
      const groupDm = {
        ...baseChannel,
        type: 'GROUP_DM' as const,
        member_ids: ['user-1', 'user-2', 'user-3'],
      };
      mockChannelRepo.create.mockResolvedValue(groupDm);

      const result = await service.createGroupDm(
        'ch-1',
        ['user-1', 'user-2', 'user-3'],
      );
      expect(result.type).toBe('GROUP_DM');
    });

    it('should reject group DM exceeding 10 members', async () => {
      const memberIds = Array.from({ length: 11 }, (_, i) => `user-${i}`);
      await expect(
        service.createGroupDm('ch-1', memberIds),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteChannel', () => {
    it('should delete existing channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.delete.mockResolvedValue();

      await service.deleteChannel('ch-chan-1', 'ch-1');
      expect(mockChannelRepo.delete).toHaveBeenCalledWith('ch-chan-1', 'ch-1');
    });

    it('should throw if channel not found', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);
      await expect(
        service.deleteChannel('ch-chan-x', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Messages ─────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should send a message', async () => {
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      const result = await service.sendMessage({
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello world',
      });

      expect(result).toEqual(baseMessage);
    });

    it('should reject empty content', async () => {
      await expect(
        service.sendMessage({
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('editMessage', () => {
    it('should edit own message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        content: 'Updated',
        edited_at: '2026-01-01T13:00:00.000Z',
      });

      const result = await service.editMessage('msg-1', 'user-1', 'Updated');
      expect(result.content).toBe('Updated');
      expect(result.edited_at).toBeTruthy();
    });

    it('should reject editing another user\'s message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.editMessage('msg-1', 'user-2', 'Hacked'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject editing deleted message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await expect(
        service.editMessage('msg-1', 'user-1', 'Updated'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteMessage', () => {
    it('should soft-delete own message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        content: '[message deleted]',
        is_deleted: true,
      });

      const result = await service.deleteMessage('msg-1', 'user-1', false);
      expect(result.is_deleted).toBe(true);
      expect(result.content).toBe('[message deleted]');
    });

    it('should allow admin to delete any message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await service.deleteMessage('msg-1', 'user-2', true);
      expect(mockMessageRepo.update).toHaveBeenCalled();
    });

    it('should reject non-owner without permission', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.deleteMessage('msg-1', 'user-2', false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Pins ─────────────────────────────────────────────────────────────

  describe('pinMessage', () => {
    it('should pin a message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.countPinnedByChannel.mockResolvedValue(5);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        is_pinned: true,
      });

      const result = await service.pinMessage('msg-1');
      expect(result.is_pinned).toBe(true);
    });

    it('should reject pinning already pinned message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_pinned: true,
      });

      await expect(service.pinMessage('msg-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject pinning when at 50 limit', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.countPinnedByChannel.mockResolvedValue(50);

      await expect(service.pinMessage('msg-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('unpinMessage', () => {
    it('should unpin a message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_pinned: true,
      });
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        is_pinned: false,
      });

      const result = await service.unpinMessage('msg-1');
      expect(result.is_pinned).toBe(false);
    });

    it('should reject unpinning non-pinned message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(service.unpinMessage('msg-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── Reactions ────────────────────────────────────────────────────────

  describe('toggleReaction', () => {
    it('should add a reaction when none exists', async () => {
      mockReactionRepo.findOne.mockResolvedValue(null);
      const newReaction: MessageReaction = {
        id: 'rxn-1',
        message_id: 'msg-1',
        user_id: 'user-1',
        emoji: '👍',
        created_at: '2026-01-01T12:00:00.000Z',
      };
      mockReactionRepo.create.mockResolvedValue(newReaction);

      const result = await service.toggleReaction('msg-1', 'user-1', '👍');
      expect(result.action).toBe('added');
    });

    it('should remove a reaction when it already exists', async () => {
      const existing: MessageReaction = {
        id: 'rxn-1',
        message_id: 'msg-1',
        user_id: 'user-1',
        emoji: '👍',
        created_at: '2026-01-01T12:00:00.000Z',
      };
      mockReactionRepo.findOne.mockResolvedValue(existing);
      mockReactionRepo.delete.mockResolvedValue();

      const result = await service.toggleReaction('msg-1', 'user-1', '👍');
      expect(result.action).toBe('removed');
    });
  });

  // ── Read Receipts ────────────────────────────────────────────────────

  describe('markChannelRead', () => {
    it('should upsert read receipt', async () => {
      mockReadReceiptRepo.upsert.mockResolvedValue({
        id: 'rr-1',
        channel_id: 'ch-chan-1',
        user_id: 'user-1',
        last_read_at: '2026-01-01T12:00:00.000Z',
        updated_at: '2026-01-01T12:00:00.000Z',
      });

      const result = await service.markChannelRead('ch-chan-1', 'user-1');
      expect(result.channel_id).toBe('ch-chan-1');
    });
  });

  // ── File Upload ─────────────────────────────────────────────────────

  describe('requestChatUploadUrl', () => {
    it('should generate a signed upload URL for an allowed content type', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );

      const result = await service.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'photo.png',
        'image/png',
      );

      expect(result.signedUrl).toBe('https://storage.example.com/signed-url');
      expect(result.storagePath).toContain('chapters/ch-1/chat/ch-chan-1/');
      expect(result.storagePath).toContain('/photo.png');
      expect(result.messageId).toBeDefined();
      expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
        'chat',
        expect.stringContaining('chapters/ch-1/chat/ch-chan-1/'),
        'image/png',
      );
    });

    it('should reject blocked executable content types', async () => {
      await expect(
        service.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'virus.exe',
          'application/x-msdownload',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject blocked .sh files', async () => {
      await expect(
        service.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'script.sh',
          'application/x-sh',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject blocked .bat files', async () => {
      await expect(
        service.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'run.bat',
          'application/x-bat',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject disallowed content type even with allowed extension', async () => {
      await expect(
        service.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'file.zip',
          'application/zip',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept PDF content type', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );

      const result = await service.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'document.pdf',
        'application/pdf',
      );

      expect(result.signedUrl).toBeDefined();
      expect(result.storagePath).toContain('/document.pdf');
    });
  });

  // ── Notification triggers ──────────────────────────────────────────

  describe('sendMessage notifications', () => {
    it('should notify DM recipients', async () => {
      const dmChannel: ChatChannel = {
        ...baseChannel,
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };
      mockMessageRepo.create.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue(dmChannel);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello!',
      });

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'ch-1',
        expect.objectContaining({
          title: 'New Message',
          priority: 'NORMAL',
          category: 'chat',
        }),
      );
    });

    it('should notify chapter for announcement messages', async () => {
      const announcementChannel: ChatChannel = {
        ...baseChannel,
        name: 'announcements',
        type: 'PUBLIC',
      };
      mockMessageRepo.create.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue(announcementChannel);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Important update!',
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'New Announcement',
          priority: 'URGENT',
          category: 'announcements',
        }),
      );
    });

    it('should not fail if notification throws on sendMessage', async () => {
      const dmChannel: ChatChannel = {
        ...baseChannel,
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };
      mockMessageRepo.create.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue(dmChannel);
      mockNotificationService.notifyUser.mockRejectedValue(new Error('push failed'));

      const result = await service.sendMessage({
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello!',
      });

      expect(result).toEqual(baseMessage);
    });
  });
});
