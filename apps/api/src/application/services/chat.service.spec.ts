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
  CHAT_MESSAGE_ACTION_REPOSITORY,
  ChatMessageActionDuplicateError,
  ChatMessageDuplicateError,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatCategoryRepository,
  IChatMessageActionRepository,
  IChatMessageRepository,
  IMessageReactionRepository,
  IChannelReadReceiptRepository,
} from '../../domain/repositories/chat.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  ChatChannel,
  ChatMessage,
  ChatMessageAction,
  ChatChannelCategory,
  MessageReaction,
} from '../../domain/entities/chat.entity';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import { ChannelAccessService } from './channel-access.service';

describe('ChatService', () => {
  let service: ChatService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockCategoryRepo: jest.Mocked<IChatCategoryRepository>;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockActionRepo: jest.Mocked<IChatMessageActionRepository>;
  let mockReactionRepo: jest.Mocked<IMessageReactionRepository>;
  let mockReadReceiptRepo: jest.Mocked<IChannelReadReceiptRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockMemberRepo: { findByUserAndChapter: jest.Mock };
  let mockRbac: {
    getEffectivePermissions: jest.Mock;
    hasAlumniRole: jest.Mock;
  };
  /**
   * The Realtime broadcast goes through `SUPABASE_CLIENT.channel(topic)` →
   * `channel.send({ ... })` and is best-effort. Wire a fake that records
   * the topic + payload so `sendMessage` tests can assert the emit.
   */
  let mockSupabase: {
    channel: jest.Mock;
    removeChannel: jest.Mock;
  };
  let broadcasts: Array<{
    topic: string;
    payload: { type: string; event: string; payload: unknown };
  }>;

  const baseMember = {
    id: 'mem-1',
    user_id: 'user-1',
    chapter_id: 'ch-1',
    role_ids: ['role-1'],
    has_completed_onboarding: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

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
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockMessageRepo = {
      findById: jest.fn(),
      findByChannel: jest.fn(),
      findPinnedByChannel: jest.fn(),
      countPinnedByChannel: jest.fn(),
      findPollsByChapter: jest.fn(),
      findByClientMessageId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockActionRepo = {
      create: jest.fn(),
      findOne: jest.fn(),
      updateForVote: jest.fn(),
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
      listFiles: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockMemberRepo = {
      findByUserAndChapter: jest.fn(),
    };

    mockRbac = {
      getEffectivePermissions: jest.fn(),
      // Active (non-alumni) member by default; alumni posting is covered in
      // channel-access.service.spec.ts.
      hasAlumniRole: jest.fn().mockResolvedValue(false),
    };

    broadcasts = [];
    mockSupabase = {
      channel: jest.fn((topic: string) => ({
        send: jest.fn(async (payload) => {
          broadcasts.push({ topic, payload });
          return 'ok';
        }),
      })),
      removeChannel: jest.fn().mockResolvedValue(undefined),
    };

    // Defaults: caller is a member of the chapter, channel resolves, no special
    // permissions. Individual tests override to exercise denial paths.
    mockChannelRepo.findById.mockResolvedValue(baseChannel);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
    mockMessageRepo.findById.mockResolvedValue(baseMessage);
    mockRbac.getEffectivePermissions.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
        { provide: CHAT_CATEGORY_REPOSITORY, useValue: mockCategoryRepo },
        { provide: CHAT_MESSAGE_REPOSITORY, useValue: mockMessageRepo },
        {
          provide: CHAT_MESSAGE_ACTION_REPOSITORY,
          useValue: mockActionRepo,
        },
        { provide: MESSAGE_REACTION_REPOSITORY, useValue: mockReactionRepo },
        {
          provide: CHANNEL_READ_RECEIPT_REPOSITORY,
          useValue: mockReadReceiptRepo,
        },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: RbacService, useValue: mockRbac },
        // ChatService now authorizes through the shared ChannelAccessService;
        // wire a real one over the same mocked channel/member/rbac so the
        // existing PRIVATE / ROLE_GATED rejection tests still exercise the
        // predicate end-to-end.
        ChannelAccessService,
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

      const result = await service.createGroupDm('ch-1', [
        'user-1',
        'user-2',
        'user-3',
      ]);
      expect(result.type).toBe('GROUP_DM');
    });

    it('should reject group DM exceeding 10 members', async () => {
      const memberIds = Array.from({ length: 11 }, (_, i) => `user-${i}`);
      await expect(service.createGroupDm('ch-1', memberIds)).rejects.toThrow(
        BadRequestException,
      );
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
      await expect(service.deleteChannel('ch-chan-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteCategory', () => {
    const baseCategory = {
      id: 'cat-1',
      chapter_id: 'ch-1',
      name: 'General',
      display_order: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    it('should delete category by id', async () => {
      mockCategoryRepo.findById.mockResolvedValue(baseCategory);
      mockCategoryRepo.delete.mockResolvedValue();

      await service.deleteCategory('cat-1', 'ch-1');
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith('cat-1', 'ch-1');
    });

    // chat_channels.category_id is ON DELETE SET NULL, so an unscoped delete
    // would silently un-categorize another tenant's channels.
    it('should not delete a category belonging to another chapter', async () => {
      mockCategoryRepo.findById.mockResolvedValue(null);

      await expect(service.deleteCategory('cat-1', 'ch-other')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockCategoryRepo.delete).not.toHaveBeenCalled();
    });

    it('should not update a category belonging to another chapter', async () => {
      mockCategoryRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateCategory('cat-1', 'ch-other', { name: 'Renamed' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockCategoryRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── Messages ─────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return messages without pagination options', async () => {
      const messages = [baseMessage];
      mockMessageRepo.findByChannel.mockResolvedValue(messages);

      const result = await service.getMessages('ch-chan-1', 'ch-1', 'user-1');

      expect(mockMessageRepo.findByChannel).toHaveBeenCalledWith(
        'ch-chan-1',
        undefined,
      );
      expect(result).toEqual(messages);
    });

    it('should pass pagination options to repository', async () => {
      const messages = [baseMessage];
      mockMessageRepo.findByChannel.mockResolvedValue(messages);

      const options = { limit: 20, before: 'msg-5' };
      const result = await service.getMessages(
        'ch-chan-1',
        'ch-1',
        'user-1',
        options,
      );

      expect(mockMessageRepo.findByChannel).toHaveBeenCalledWith(
        'ch-chan-1',
        options,
      );
      expect(result).toEqual(messages);
    });

    it('should reject reads when the channel is in another chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.getMessages('ch-chan-x', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.findByChannel).not.toHaveBeenCalled();
    });

    it('should reject reads from a non-member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'outsider'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.findByChannel).not.toHaveBeenCalled();
    });

    it('should reject reads from a non-participant of a private channel', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'PRIVATE',
        member_ids: ['user-2'],
      });

      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow reads of a role-gated channel when the caller holds the permission', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'ROLE_GATED',
        required_permissions: ['alumni:view'],
      });
      mockRbac.getEffectivePermissions.mockResolvedValue(['alumni:view']);
      mockMessageRepo.findByChannel.mockResolvedValue([baseMessage]);

      const result = await service.getMessages('ch-chan-1', 'ch-1', 'user-1');
      expect(result).toEqual([baseMessage]);
    });

    it('should reject reads of a role-gated channel without the permission', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'ROLE_GATED',
        required_permissions: ['alumni:view'],
      });
      mockRbac.getEffectivePermissions.mockResolvedValue(['events:create']);

      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sendMessage', () => {
    it('should send a message', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      const result = await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello world',
      });

      expect(result).toEqual({ message: baseMessage, deduplicated: false });
    });

    it('passes client_message_id, kind, and payload into the insert', async () => {
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello',
        client_message_id: '11111111-1111-1111-1111-111111111111',
        kind: 'announcement',
        payload: { foo: 'bar' },
      });

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          client_message_id: '11111111-1111-1111-1111-111111111111',
          kind: 'announcement',
          payload: { foo: 'bar' },
        }),
      );
    });

    it('rejects client posts of server-originated kinds (points, system_audit)', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      for (const kind of ['points', 'system_audit'] as const) {
        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'forged card',
            kind,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }

      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('allows server-originated kinds when system_originated is set', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Granted 5 points to Bob: great work',
        kind: 'points',
        payload: { amount: 5 },
        system_originated: true,
      });

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'points' }),
      );
    });

    it('still allows client posts of the loading placeholder kind', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Recording points…',
        kind: 'loading',
      });

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'loading' }),
      );
    });

    it('returns the existing row with deduplicated:true on a client_message_id retry', async () => {
      const clientId = '22222222-2222-2222-2222-222222222222';
      mockMessageRepo.create.mockRejectedValue(
        new ChatMessageDuplicateError('ch-chan-1', 'user-1', clientId),
      );
      mockMessageRepo.findByClientMessageId.mockResolvedValue(baseMessage);

      const result = await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello',
        client_message_id: clientId,
      });

      expect(result).toEqual({ message: baseMessage, deduplicated: true });
      expect(mockMessageRepo.findByClientMessageId).toHaveBeenCalledWith(
        'ch-chan-1',
        'user-1',
        clientId,
      );
    });

    it('rethrows when the duplicate-error path cannot re-select an existing row', async () => {
      const clientId = '33333333-3333-3333-3333-333333333333';
      mockMessageRepo.create.mockRejectedValue(
        new ChatMessageDuplicateError('ch-chan-1', 'user-1', clientId),
      );
      mockMessageRepo.findByClientMessageId.mockResolvedValue(null);

      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Hello',
          client_message_id: clientId,
        }),
      ).rejects.toBeInstanceOf(ChatMessageDuplicateError);
    });

    it('emits a Realtime broadcast for new messages on the chapter:<channel_id> topic', async () => {
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello',
      });

      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0]).toEqual({
        topic: `chapter:${baseMessage.channel_id}`,
        payload: {
          type: 'broadcast',
          event: 'new_message',
          payload: baseMessage,
        },
      });
    });

    it('does NOT broadcast (and does NOT insert) when authz denies the send', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'outsider',
          content: 'Hello',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
      expect(broadcasts).toHaveLength(0);
    });

    it('still returns success when the broadcast throws (Postgres Changes is the source of truth)', async () => {
      mockMessageRepo.create.mockResolvedValue(baseMessage);
      mockSupabase.channel.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const result = await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello',
      });

      expect(result.message).toEqual(baseMessage);
    });

    it('should reject empty content', async () => {
      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when channel is not found for chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-missing',
          sender_id: 'user-1',
          content: 'Hello world',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a non-member sender', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'outsider',
          content: 'Hello world',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a sender not in a private channel', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'PRIVATE',
        member_ids: ['user-2'],
      });

      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Hello world',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a reply targeting a message in another channel', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        id: 'msg-other',
        channel_id: 'ch-chan-OTHER',
      });

      await expect(
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Hello world',
          reply_to_id: 'msg-other',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('should accept a reply targeting a message in the same channel', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        id: 'msg-same',
        channel_id: 'ch-chan-1',
      });
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      const result = await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello world',
        reply_to_id: 'msg-same',
      });
      expect(result).toEqual({ message: baseMessage, deduplicated: false });
      expect(mockMessageRepo.create).toHaveBeenCalled();
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

      const result = await service.editMessage(
        'msg-1',
        'ch-1',
        'user-1',
        'Updated',
      );
      expect(result.content).toBe('Updated');
      expect(result.edited_at).toBeTruthy();
    });

    it("should reject editing another user's message", async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-2', 'Hacked'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject editing deleted message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-1', 'Updated'),
      ).rejects.toThrow(BadRequestException);
    });

    // An edit writes new member-authored content into the channel, so it must
    // clear the same post-side gates as sending. Otherwise the alumni rule and
    // the read-only gate are both bypassable by editing an older message
    // instead of sending a new one.
    it('blocks an alumni member from rewriting their own message in an operational channel', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockRbac.hasAlumniRole.mockResolvedValue(true);

      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-1', 'Rewritten'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockMessageRepo.update).not.toHaveBeenCalled();
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

      const result = await service.deleteMessage(
        'msg-1',
        'ch-1',
        'user-1',
        false,
      );
      expect(result.is_deleted).toBe(true);
      expect(result.content).toBe('[message deleted]');
    });

    it('should allow admin to delete any message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await service.deleteMessage('msg-1', 'ch-1', 'user-2', true);
      expect(mockMessageRepo.update).toHaveBeenCalled();
    });

    it('should reject non-owner without permission', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.deleteMessage('msg-1', 'ch-1', 'user-2', false),
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

      const result = await service.pinMessage('msg-1', 'ch-1', 'user-1');
      expect(result.is_pinned).toBe(true);
    });

    it('should reject pinning already pinned message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_pinned: true,
      });

      await expect(
        service.pinMessage('msg-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject pinning when at 50 limit', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.countPinnedByChannel.mockResolvedValue(50);

      await expect(
        service.pinMessage('msg-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
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

      const result = await service.unpinMessage('msg-1', 'ch-1', 'user-1');
      expect(result.is_pinned).toBe(false);
    });

    it('should reject unpinning non-pinned message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.unpinMessage('msg-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // spec/behavior/multi-tenancy.md treats cross-chapter access as a critical
  // security bug, and spec/behavior/chat/README.md requires every message
  // surface to authorize through the channel → chapter → membership lookup.
  // These paths previously mutated straight off a message UUID.
  describe('cross-chapter message mutations', () => {
    // The message resolves, but its channel does not exist in the caller's
    // active chapter — assertMessageAccess normalizes that to a 404 so a
    // caller cannot probe for message ids in other chapters.
    const messageInAnotherChapter = () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue(null);
    };

    it('refuses to edit a message from another chapter', async () => {
      messageInAnotherChapter();

      await expect(
        service.editMessage('msg-1', 'ch-other', 'user-1', 'Hacked'),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('refuses to delete a message from another chapter', async () => {
      messageInAnotherChapter();

      await expect(
        service.deleteMessage('msg-1', 'ch-other', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('refuses to pin a message from another chapter', async () => {
      messageInAnotherChapter();

      await expect(
        service.pinMessage('msg-1', 'ch-other', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('refuses to unpin a message from another chapter', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_pinned: true,
      });
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.unpinMessage('msg-1', 'ch-other', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
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

      const result = await service.toggleReaction(
        'msg-1',
        'ch-1',
        'user-1',
        '👍',
      );
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

      const result = await service.toggleReaction(
        'msg-1',
        'ch-1',
        'user-1',
        '👍',
      );
      expect(result.action).toBe('removed');
    });

    it('should reject reacting to a message the caller cannot access', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.toggleReaction('msg-1', 'ch-1', 'outsider', '👍'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockReactionRepo.create).not.toHaveBeenCalled();
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

      const result = await service.markChannelRead(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );
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
        'user-1',
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
          'user-1',
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
          'user-1',
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
          'user-1',
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
          'user-1',
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
        'user-1',
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
        chapter_id: 'ch-1',
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
        chapter_id: 'ch-1',
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
      mockNotificationService.notifyUser.mockRejectedValue(
        new Error('push failed'),
      );

      const result = await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello!',
      });

      expect(result.message).toEqual(baseMessage);
    });
  });

  // ── Hot-path actions (chat_message_actions) ──────────────────────────

  describe('recordMessageAction', () => {
    const baseAction: ChatMessageAction = {
      id: 'action-1',
      message_id: 'msg-1',
      user_id: 'user-1',
      action_type: 'reaction:👍',
      payload: {},
      created_at: '2026-01-01T12:00:00.000Z',
    };

    it('records a reaction and returns deduplicated:false on the happy path', async () => {
      mockActionRepo.create.mockResolvedValue(baseAction);

      const result = await service.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'reaction:👍' },
      );

      expect(result).toEqual({ action: baseAction, deduplicated: false });
      expect(mockActionRepo.create).toHaveBeenCalledWith({
        message_id: 'msg-1',
        user_id: 'user-1',
        action_type: 'reaction:👍',
        payload: {},
      });
    });

    it('rejects when the caller cannot access the message', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.recordMessageAction('msg-1', 'ch-1', 'outsider', {
          action_type: 'reaction:👍',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockActionRepo.create).not.toHaveBeenCalled();
    });

    it('on a unique-violation for an emoji reaction, surfaces the existing row as deduplicated:true (no second insert)', async () => {
      mockActionRepo.create.mockRejectedValue(
        new ChatMessageActionDuplicateError('msg-1', 'user-1', 'reaction:👍'),
      );
      mockActionRepo.findOne.mockResolvedValue(baseAction);

      const result = await service.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'reaction:👍' },
      );

      expect(result).toEqual({ action: baseAction, deduplicated: true });
      expect(mockActionRepo.create).toHaveBeenCalledTimes(1);
      expect(mockActionRepo.findOne).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        'reaction:👍',
      );
      expect(mockActionRepo.updateForVote).not.toHaveBeenCalled();
    });

    it('on a unique-violation for action_type="vote", UPSERTS the payload and returns updated:true (ADR-07)', async () => {
      const updatedAction = {
        ...baseAction,
        action_type: 'vote',
        payload: { option: 2 },
      };
      mockActionRepo.create.mockRejectedValue(
        new ChatMessageActionDuplicateError('msg-1', 'user-1', 'vote'),
      );
      mockActionRepo.updateForVote.mockResolvedValue(updatedAction);

      const result = await service.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'vote', payload: { option: 2 } },
      );

      expect(result).toEqual({
        action: updatedAction,
        deduplicated: false,
        updated: true,
      });
      expect(mockActionRepo.updateForVote).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        'vote',
        { option: 2 },
      );
    });

    it('rethrows non-23505 insert errors instead of falsely deduping', async () => {
      mockActionRepo.create.mockRejectedValue(new Error('schema mismatch'));

      await expect(
        service.recordMessageAction('msg-1', 'ch-1', 'user-1', {
          action_type: 'reaction:👍',
        }),
      ).rejects.toThrow('schema mismatch');
    });
  });
});
