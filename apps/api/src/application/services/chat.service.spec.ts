import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { canAccessChannel } from '@repo/validation';
import { ChatService } from './chat.service';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  ChatMessageActionDuplicateError,
  ChatMessageDuplicateError,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatCategoryRepository,
  IChatMessageActionRepository,
  IChatMessageAttachmentRepository,
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
import { ActivationService } from './activation.service';
import { RbacService } from './rbac.service';
import { ChannelAccessService } from './channel-access.service';
import { ChatNotificationPreferenceRepository } from '../../modules/chat-push-worker/chat-notification-preference.repository';
import { ChannelCacheService } from '../../modules/chat-push-worker/channel-cache.service';

describe('ChatService', () => {
  let service: ChatService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockCategoryRepo: jest.Mocked<IChatCategoryRepository>;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockActionRepo: jest.Mocked<IChatMessageActionRepository>;
  let mockAttachmentRepo: jest.Mocked<IChatMessageAttachmentRepository>;
  let mockReactionRepo: jest.Mocked<IMessageReactionRepository>;
  let mockReadReceiptRepo: jest.Mocked<IChannelReadReceiptRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockMemberRepo: {
    findByUserAndChapter: jest.Mock;
    findByChapter: jest.Mock;
    findChapterMemberIdentities: jest.Mock;
  };
  let mockActivation: jest.Mocked<Pick<ActivationService, 'record'>>;
  let mockChatNotificationPrefs: {
    findChannelPreferencesForUser: jest.Mock;
    upsertChannelLevel: jest.Mock;
  };
  let mockChannelCache: {
    get: jest.Mock;
    set: jest.Mock;
    invalidate: jest.Mock;
  };
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
    archived_at: null,
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
      leaveGroupDm: jest.fn(),
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

    mockAttachmentRepo = {
      createMany: jest.fn().mockResolvedValue([]),
      findByMessage: jest.fn().mockResolvedValue([]),
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
      getUnreadCounts: jest.fn().mockResolvedValue([]),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      listFiles: jest.fn(),
      listObjects: jest.fn().mockResolvedValue([]),
      listFolders: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockMemberRepo = {
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn().mockResolvedValue([]),
      // Mention resolution reads the chapter roster through this one narrow
      // join (#986). Empty by default so the existing send tests resolve to no
      // mentions; the mention tests below seed it.
      findChapterMemberIdentities: jest.fn().mockResolvedValue([]),
    };

    mockActivation = { record: jest.fn().mockResolvedValue(true) };

    mockChatNotificationPrefs = {
      findChannelPreferencesForUser: jest.fn().mockResolvedValue([]),
      upsertChannelLevel: jest.fn(),
    };

    mockChannelCache = {
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn(),
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
        {
          provide: CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
          useValue: mockAttachmentRepo,
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
        { provide: ActivationService, useValue: mockActivation },
        // ChatService now authorizes through the shared ChannelAccessService;
        // wire a real one over the same mocked channel/member/rbac so the
        // existing PRIVATE / ROLE_GATED rejection tests still exercise the
        // predicate end-to-end.
        ChannelAccessService,
        {
          provide: ChatNotificationPreferenceRepository,
          useValue: mockChatNotificationPrefs,
        },
        { provide: ChannelCacheService, useValue: mockChannelCache },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  // ── Channels ─────────────────────────────────────────────────────────

  describe('createChannel', () => {
    it('should create a PUBLIC channel', async () => {
      mockChannelRepo.create.mockResolvedValue(baseChannel);

      const result = await service.createChannel(
        {
          chapter_id: 'ch-1',
          name: 'general',
          type: 'PUBLIC',
        },
        'u-creator',
      );

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
        service.createChannel(
          {
            chapter_id: 'ch-1',
            name: 'dm',
            type: 'DM',
          },
          'u-creator',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // FRA-321: canAccessChannel denies a ROLE_GATED channel that gates on
    // nothing, so creating one would strand it. Reject the shape at the door.
    it.each([undefined, []])(
      'should reject a ROLE_GATED channel with required_permissions %p',
      async (required) => {
        await expect(
          service.createChannel(
            {
              chapter_id: 'ch-1',
              name: 'exec-board',
              type: 'ROLE_GATED',
              required_permissions: required,
            },
            'u-creator',
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockChannelRepo.create).not.toHaveBeenCalled();
      },
    );

    // #1008: `member_ids` NULL makes a PRIVATE channel unreadable by everyone
    // including its creator, with no repair path — `updateChannel` cannot write
    // the column. The row is only reachable from the create response's id.
    it('should seed a PRIVATE channel with its creator', async () => {
      mockChannelRepo.create.mockResolvedValue(baseChannel);

      await service.createChannel(
        {
          chapter_id: 'ch-1',
          name: 'exec-private',
          type: 'PRIVATE',
        },
        'u-creator',
      );

      expect(mockChannelRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PRIVATE',
          member_ids: ['u-creator'],
        }),
      );
    });

    // The seeded row must actually satisfy the predicate that reads it —
    // asserting the insert shape alone would not prove the channel is readable.
    it('should produce a PRIVATE row its creator can actually read', async () => {
      mockChannelRepo.create.mockImplementation((data) =>
        Promise.resolve({ ...baseChannel, ...data } as ChatChannel),
      );

      const created = await service.createChannel(
        {
          chapter_id: 'ch-1',
          name: 'exec-private',
          type: 'PRIVATE',
        },
        'u-creator',
      );

      expect(
        canAccessChannel({
          channel: created,
          userId: 'u-creator',
          isChapterMember: true,
          permissions: [],
        }),
      ).toBe(true);
    });

    // A PRIVATE channel is not a public one: seeding the creator must not make
    // it readable by another chapter member.
    it('should not make a seeded PRIVATE channel readable by anyone else', async () => {
      mockChannelRepo.create.mockImplementation((data) =>
        Promise.resolve({ ...baseChannel, ...data } as ChatChannel),
      );

      const created = await service.createChannel(
        {
          chapter_id: 'ch-1',
          name: 'exec-private',
          type: 'PRIVATE',
        },
        'u-creator',
      );

      expect(
        canAccessChannel({
          channel: created,
          userId: 'u-other',
          isChapterMember: true,
          // Even `*` must not open it: the PRIVATE branch has no wildcard bypass.
          permissions: ['*'],
        }),
      ).toBe(false);
    });

    // PUBLIC and ROLE_GATED resolve access by chapter membership and by
    // permissions; a membership list there would imply something that is never
    // consulted.
    it.each(['PUBLIC', 'ROLE_GATED'] as const)(
      'should not seed member_ids on a %s channel',
      async (type) => {
        mockChannelRepo.create.mockResolvedValue(baseChannel);

        await service.createChannel(
          {
            chapter_id: 'ch-1',
            name: 'general',
            type,
            required_permissions:
              type === 'ROLE_GATED' ? ['roles:manage'] : undefined,
          },
          'u-creator',
        );

        expect(mockChannelRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ member_ids: null }),
        );
      },
    );

    it('should create a ROLE_GATED channel that specifies requirements', async () => {
      mockChannelRepo.create.mockResolvedValue(baseChannel);

      await service.createChannel(
        {
          chapter_id: 'ch-1',
          name: 'exec-board',
          type: 'ROLE_GATED',
          required_permissions: ['roles:manage'],
        },
        'u-creator',
      );

      expect(mockChannelRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ROLE_GATED',
          required_permissions: ['roles:manage'],
        }),
      );
    });
  });

  describe('updateChannel', () => {
    const roleGated = {
      ...baseChannel,
      type: 'ROLE_GATED' as const,
      required_permissions: ['roles:manage'],
    };

    it('should reject clearing required_permissions on a ROLE_GATED channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGated);

      await expect(
        service.updateChannel('chan-1', 'ch-1', { required_permissions: [] }),
      ).rejects.toThrow(BadRequestException);

      expect(mockChannelRepo.update).not.toHaveBeenCalled();
    });

    it('should leave the stored list intact when the field is omitted', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGated);
      mockChannelRepo.update.mockResolvedValue(roleGated);

      await service.updateChannel('chan-1', 'ch-1', { name: 'renamed' });

      expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
        name: 'renamed',
      });
    });

    it('should allow clearing required_permissions on a non-ROLE_GATED channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.update.mockResolvedValue(baseChannel);

      await service.updateChannel('chan-1', 'ch-1', {
        required_permissions: [],
      });

      expect(mockChannelRepo.update).toHaveBeenCalled();
    });

    // Regression for the Chat Admin UI (#327): `category_id: undefined` is
    // dropped by JSON serialization before the request even leaves the
    // client, so "move this channel back to uncategorized" is only
    // expressible as a literal `null` in the body. `UpdateChannelDto.category_id`
    // is `@IsOptional() @IsUUID()`, which class-validator treats `null` the
    // same as `undefined` (both skip `@IsUUID()`), so the DTO accepts it and
    // this pins that the service passes it straight through rather than
    // coercing it back to `undefined` — which would silently un-fix the bug.
    it('should pass category_id: null through to the repository, clearing the category', async () => {
      const categorized = { ...baseChannel, category_id: 'cat-1' };
      mockChannelRepo.findById.mockResolvedValue(categorized);
      mockChannelRepo.update.mockResolvedValue({
        ...categorized,
        category_id: null,
      });

      await service.updateChannel('chan-1', 'ch-1', { category_id: null });

      expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
        category_id: null,
      });
    });

    // #988: the push worker's channel cache carries `required_permissions` as
    // an authorization input. A write that changes it must evict the cached
    // entry rather than let up to 30s of pushes decide from the old value.
    it('evicts the push worker channel cache on a successful update', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.update.mockResolvedValue(baseChannel);

      await service.updateChannel('chan-1', 'ch-1', {
        required_permissions: ['roles:manage'],
      });

      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-1');
    });

    it('does not evict the cache when the update is rejected', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGated);

      await expect(
        service.updateChannel('chan-1', 'ch-1', { required_permissions: [] }),
      ).rejects.toThrow(BadRequestException);

      expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
    });
  });

  // A channel row is not neutral metadata. `name` + `member_ids` +
  // the server's `dm-<a>-<b>` naming means one unfiltered row discloses a DM
  // pair twice over, so these assert on the payload, not on what a UI draws.
  describe('channel reads are access-filtered', () => {
    const dmMine: ChatChannel = {
      ...baseChannel,
      id: 'ch-dm-mine',
      name: 'dm-user-1-user-2',
      type: 'DM',
      member_ids: ['user-1', 'user-2'],
    };
    const dmTheirs: ChatChannel = {
      ...baseChannel,
      id: 'ch-dm-theirs',
      name: 'dm-user-2-user-3',
      type: 'DM',
      member_ids: ['user-2', 'user-3'],
    };
    const privMine: ChatChannel = {
      ...baseChannel,
      id: 'ch-priv-mine',
      name: 'my-committee',
      type: 'PRIVATE',
      member_ids: ['user-1'],
    };
    const privTheirs: ChatChannel = {
      ...baseChannel,
      id: 'ch-priv-theirs',
      name: 'exec-secrets',
      description: 'exec only',
      type: 'PRIVATE',
      member_ids: ['user-2'],
    };
    const roleGated: ChatChannel = {
      ...baseChannel,
      id: 'ch-exec',
      name: 'exec',
      type: 'ROLE_GATED',
      required_permissions: ['roles:manage'],
    };
    // The row shape #1008 was about: a PRIVATE channel whose membership is
    // NULL. `privMine`/`privTheirs` both carry explicit lists, so they encode a
    // shape the API could produce only *after* the creator seed — this one
    // covers the orphan. It is unreachable through create now, but #1302's
    // remove-member route can reproduce it by removing the last member, which
    // is the hazard that issue's own criteria call out.
    const privOrphan: ChatChannel = {
      ...baseChannel,
      id: 'ch-priv-orphan',
      name: 'orphaned-committee',
      type: 'PRIVATE',
      member_ids: null,
    };
    const everything = [
      baseChannel,
      dmMine,
      dmTheirs,
      privMine,
      privTheirs,
      privOrphan,
      roleGated,
    ];

    describe('getChannels', () => {
      it('returns PUBLIC channels, the caller’s own DM, and their own PRIVATE channel', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result.map((channel) => channel.id)).toEqual([
          'ch-chan-1',
          'ch-dm-mine',
          'ch-priv-mine',
        ]);
      });

      it('hides a PRIVATE channel whose member_ids is NULL from everyone', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);

        for (const userId of ['user-1', 'user-2', 'user-3']) {
          const result = await service.getChannels('ch-1', userId);
          expect(result.map((channel) => channel.id)).not.toContain(
            'ch-priv-orphan',
          );
        }
      });

      it('does not return a DM between two other members', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);

        const result = await service.getChannels('ch-1', 'user-1');

        // The pair leaks through two independent fields, so assert both: the
        // uuid pair is in `name` as well as in `member_ids`.
        expect(result.map((channel) => channel.id)).not.toContain(
          'ch-dm-theirs',
        );
        expect(result.some((channel) => channel.name.includes('user-3'))).toBe(
          false,
        );
        expect(
          result.some((channel) =>
            (channel.member_ids ?? []).includes('user-3'),
          ),
        ).toBe(false);
      });

      it('does not return another member’s PRIVATE channel', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([
          baseChannel,
          privTheirs,
        ]);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result.map((channel) => channel.id)).toEqual(['ch-chan-1']);
        expect(
          result.some((channel) => channel.description === 'exec only'),
        ).toBe(false);
      });

      it('hides a ROLE_GATED channel the caller lacks the permission for', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([roleGated]);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result).toEqual([]);
      });

      it('returns a ROLE_GATED channel once the caller holds a required permission', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([roleGated]);
        mockRbac.getEffectivePermissions.mockResolvedValue(['roles:manage']);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result.map((channel) => channel.id)).toEqual(['ch-exec']);
      });

      it('returns nothing for a caller who is not a chapter member', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

        const result = await service.getChannels('ch-1', 'ghost');

        expect(result).toEqual([]);
      });

      it('returns an empty list without a membership lookup when the chapter has no channels', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([]);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result).toEqual([]);
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      });

      it('does not resolve permissions when no ROLE_GATED channel is present', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([baseChannel, dmMine]);

        await service.getChannels('ch-1', 'user-1');

        expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
      });

      it('reads the chapter’s channels exactly once', async () => {
        // Pins the array-taking filter. Routing this list back through
        // `filterAccessibleChannelIds` would re-read every channel in the
        // chapter on a request that already holds the rows.
        mockChannelRepo.findByChapter.mockResolvedValue(everything);

        await service.getChannels('ch-1', 'user-1');

        expect(mockChannelRepo.findByChapter).toHaveBeenCalledTimes(1);
      });
    });

    describe('getChannel', () => {
      it('returns a channel the caller can read', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);

        await expect(
          service.getChannel('ch-chan-1', 'ch-1', 'user-1'),
        ).resolves.toEqual(baseChannel);
      });

      it('rejects a PRIVATE channel the caller is not in', async () => {
        mockChannelRepo.findById.mockResolvedValue(privTheirs);

        await expect(
          service.getChannel('ch-priv-theirs', 'ch-1', 'user-1'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('404s a channel that does not resolve within the chapter', async () => {
        mockChannelRepo.findById.mockResolvedValue(null);

        await expect(
          service.getChannel('ch-nope', 'ch-1', 'user-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('still resolves the channel for updateChannel without a per-user check', async () => {
        // `channels:manage` authorizes the mutation; membership of the channel
        // does not. An officer editing a PRIVATE channel they are not in must
        // keep working even though they can no longer GET it.
        mockChannelRepo.findById.mockResolvedValue(privTheirs);
        mockChannelRepo.update.mockResolvedValue(privTheirs);

        await expect(
          service.updateChannel('ch-priv-theirs', 'ch-1', { name: 'renamed' }),
        ).resolves.toEqual(privTheirs);
        expect(mockChannelRepo.update).toHaveBeenCalled();
      });

      it('still resolves the channel for deleteChannel without a per-user check', async () => {
        mockChannelRepo.findById.mockResolvedValue(privTheirs);
        mockChannelRepo.delete.mockResolvedValue(undefined);

        await expect(
          service.deleteChannel('ch-priv-theirs', 'ch-1'),
        ).resolves.toBeUndefined();
        expect(mockChannelRepo.delete).toHaveBeenCalled();
      });
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

  // #348: spec/behavior/chat/README.md:47.
  describe('leaveGroupDm', () => {
    const groupDm: ChatChannel = {
      ...baseChannel,
      type: 'GROUP_DM',
      member_ids: ['user-1', 'user-2', 'user-3'],
    };

    it('calls the atomic leave RPC with the caller and target', async () => {
      mockChannelRepo.findById.mockResolvedValue(groupDm);
      mockChannelRepo.leaveGroupDm.mockResolvedValue({
        ...groupDm,
        member_ids: ['user-2', 'user-3'],
      });

      await service.leaveGroupDm('ch-chan-1', 'ch-1', 'user-1');

      // The removal + archive-threshold decision is made atomically inside
      // the `leave_group_dm` RPC (see its migration comment) rather than
      // computed here and written back — no member_ids/archived_at payload
      // is built in the service any more.
      expect(mockChannelRepo.leaveGroupDm).toHaveBeenCalledWith(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );
    });

    it('rejects leaving a non-Group-DM channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel); // PUBLIC

      await expect(
        service.leaveGroupDm('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
    });

    it('rejects leaving a 1-on-1 DM', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      });

      await expect(
        service.leaveGroupDm('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
    });

    it('rejects a Group DM the caller is not a member of', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...groupDm,
        member_ids: ['user-2', 'user-3'],
      });

      await expect(
        service.leaveGroupDm('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
    });

    it('rejects a channel in another chapter as not found', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.leaveGroupDm('ch-chan-x', 'ch-other', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
    });

    // The RPC matching zero rows (lost a race with a concurrent delete/type
    // change between the `assertChannelAccess` check and the RPC call) must
    // not be reported as success.
    it('surfaces a not-found if the RPC matches no row', async () => {
      mockChannelRepo.findById.mockResolvedValue(groupDm);
      mockChannelRepo.leaveGroupDm.mockResolvedValue(null);

      await expect(
        service.leaveGroupDm('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
    });

    it('evicts the push worker channel cache on leave', async () => {
      mockChannelRepo.findById.mockResolvedValue(groupDm);
      mockChannelRepo.leaveGroupDm.mockResolvedValue({
        ...groupDm,
        member_ids: ['user-2', 'user-3'],
      });

      await service.leaveGroupDm('ch-chan-1', 'ch-1', 'user-1');

      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('ch-chan-1');
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

    // #988: a deleted channel's row must not outlive it in the push worker's
    // cache, the same as an updated one.
    it('evicts the push worker channel cache on delete', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.delete.mockResolvedValue();

      await service.deleteChannel('ch-chan-1', 'ch-1');

      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('ch-chan-1');
    });

    it('does not evict the cache when the channel is not found', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(service.deleteChannel('ch-chan-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
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

  describe('listMessageAttachments', () => {
    const attachmentRow = {
      id: 'att-1',
      message_id: 'msg-1',
      channel_id: 'ch-chan-1',
      bucket: 'chat',
      storage_path: 'chapters/ch-1/chat/ch-chan-1/msg-1/minutes.pdf',
      filename: 'minutes.pdf',
      content_type: 'application/pdf',
      byte_size: 2048,
      width: null,
      height: null,
      external_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    it('refuses to hand out URLs for a deleted message', async () => {
      // Deletion is soft, so the ON DELETE CASCADE never fires and the rows are
      // still there. Without this the API keeps minting fresh download URLs for
      // content the sender believes they removed, and the rule would live only
      // in the web renderer — which is not where a rule about who may fetch
      // bytes belongs.
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await expect(
        service.listMessageAttachments('ch-chan-1', 'ch-1', 'user-1', 'msg-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('omits an attachment it cannot sign rather than failing the whole list', async () => {
      // One stale path used to reject the Promise.all and take every intact
      // attachment on the message down with it — the reader saw "attachments
      // couldn't be loaded" for files that were perfectly fine.
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockAttachmentRepo.findByMessage.mockResolvedValue([
        attachmentRow,
        {
          ...attachmentRow,
          id: 'att-2',
          storage_path: 'chapters/ch-1/chat/ch-chan-1/msg-1/gone.pdf',
        },
      ]);
      mockStorageProvider.getSignedDownloadUrl
        .mockResolvedValueOnce('https://signed/minutes.pdf')
        .mockRejectedValueOnce(new Error('Object not found'));

      const rows = await service.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].download_url).toBe('https://signed/minutes.pdf');
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

    it('records the first-chat-message activation milestone (#267)', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello world',
      });

      expect(mockActivation.record).toHaveBeenCalledWith(
        'ch-1',
        'activation-first-chat-message',
        { kind: 'text' },
      );
    });

    it('does not count a server-originated post as the chapter\u2019s first message (#267)', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      // The onboarding welcome post travels this path. If it counted, every
      // chapter would show as having chatted the instant it was created.
      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Welcome to your chapter.',
        kind: 'system_audit',
        system_originated: true,
      });

      expect(mockActivation.record).not.toHaveBeenCalled();
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

    describe('attachments', () => {
      const ATTACHMENT = {
        storage_path:
          'chapters/ch-1/chat/ch-chan-1/aaaaaaaa-0000-4000-8000-000000000001/minutes.pdf',
        filename: 'minutes.pdf',
        content_type: 'application/pdf',
        byte_size: 2048,
      };

      it('accepts a message that is nothing but a file', async () => {
        // The client stack allows this — the composer's Send button enables on a
        // staged chip with an empty editor — so the server has to as well. It
        // used to 400 on both the DTO's MinLength and the emptiness guard.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: '',
          attachments: [ATTACHMENT],
        });

        expect(mockAttachmentRepo.createMany).toHaveBeenCalledWith([
          expect.objectContaining({ storage_path: ATTACHMENT.storage_path }),
        ]);
      });

      it('still rejects a message with neither content nor a file', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: '   ',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('refuses an attachment whose path belongs to another channel', async () => {
        // The client uploaded through a signed URL, so it is trusted for the
        // filename and type — never for the location. Without this a caller
        // could claim any object in the bucket and be handed a signed download
        // URL for it later.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'look',
            attachments: [
              {
                ...ATTACHMENT,
                storage_path:
                  'chapters/other-chapter/chat/other-channel/m/secret.pdf',
              },
            ],
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockAttachmentRepo.createMany).not.toHaveBeenCalled();
      });

      it('stamps attachment_count so a live client knows to fetch', async () => {
        // A postgres_changes echo cannot carry a join, so this count is the only
        // way a recipient learns the message has files. Without it an
        // attachment-only message renders as an empty bubble for everyone but
        // its sender.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'deck attached',
          attachments: [ATTACHMENT],
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ attachment_count: 1 }),
          }),
        );
      });

      it('clears attachment_count when the attachment write fails', async () => {
        // The message row is already committed by the time this can fail —
        // separate PostgREST calls, no transaction — so the alternative is a
        // message that promises a file forever and renders as "attachment
        // couldn't be loaded" to everyone.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
        mockMessageRepo.findById.mockResolvedValue({
          ...baseMessage,
          metadata: { attachment_count: 1 },
        });
        mockAttachmentRepo.createMany.mockRejectedValueOnce(
          new Error('storage write failed'),
        );

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'deck attached',
            attachments: [ATTACHMENT],
          }),
        ).rejects.toThrow('storage write failed');

        expect(mockMessageRepo.update).toHaveBeenCalledWith(
          baseMessage.id,
          expect.objectContaining({
            metadata: expect.not.objectContaining({ attachment_count: 1 }),
          }),
        );
      });

      it('writes the attachments on the dedupe retry, not just the first attempt', async () => {
        // A retry reaches the dedupe path precisely when the first attempt
        // committed the message and then failed writing attachments. Returning
        // the existing row without them would make that failure permanent: no
        // later retry ever gets past the duplicate error.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockRejectedValue(
          new ChatMessageDuplicateError(
            'ch-chan-1',
            'user-1',
            '11111111-1111-1111-1111-111111111111',
          ),
        );
        mockMessageRepo.findByClientMessageId.mockResolvedValue(baseMessage);

        const result = await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'deck attached',
          client_message_id: '11111111-1111-1111-1111-111111111111',
          attachments: [ATTACHMENT],
        });

        expect(result.deduplicated).toBe(true);
        expect(mockAttachmentRepo.createMany).toHaveBeenCalledWith([
          expect.objectContaining({ message_id: baseMessage.id }),
        ]);
      });
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

    // #734: a read-only channel is a broadcast surface. `canAccessChannel`
    // decides who may author a top-level announcement; these cover the separate
    // invariant that nobody threads one, whatever they hold.
    describe('in-thread replies in a read-only channel', () => {
      const announcements: ChatChannel = {
        ...baseChannel,
        name: 'announcements',
        is_read_only: true,
      };

      it('rejects a reply from a sender holding announcements:post', async () => {
        mockChannelRepo.findById.mockResolvedValue(announcements);
        mockRbac.getEffectivePermissions.mockResolvedValue([
          'announcements:post',
        ]);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Threading a broadcast',
            reply_to_id: 'msg-same',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('rejects a reply from the President wildcard too', async () => {
        mockChannelRepo.findById.mockResolvedValue(announcements);
        mockRbac.getEffectivePermissions.mockResolvedValue(['*']);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Threading a broadcast',
            reply_to_id: 'msg-same',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('rejects before spending a lookup on the replied-to message', async () => {
        mockChannelRepo.findById.mockResolvedValue(announcements);
        mockRbac.getEffectivePermissions.mockResolvedValue([
          'announcements:post',
        ]);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Threading a broadcast',
            reply_to_id: 'msg-same',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockMessageRepo.findById).not.toHaveBeenCalled();
      });

      it('still accepts a top-level announcement from an authorized officer', async () => {
        mockChannelRepo.findById.mockResolvedValue(announcements);
        mockRbac.getEffectivePermissions.mockResolvedValue([
          'announcements:post',
        ]);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        const result = await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Chapter meeting moved to 7pm',
        });

        expect(result).toEqual({ message: baseMessage, deduplicated: false });
        expect(mockMessageRepo.create).toHaveBeenCalled();
      });

      // No "reply in a normal channel still works" case here: "should accept a
      // reply targeting a message in the same channel" above already covers it
      // with the same channel, payload, and assertions. No mutation of this
      // guard fails one without failing the other, so a read-only-specific copy
      // would assert nothing new while implying the split is covered twice.
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

  // ── Per-channel notification level (mute) ────────────────────────────

  describe('setChannelNotificationLevel', () => {
    it('upserts the level for the caller and the given channel', async () => {
      mockChatNotificationPrefs.upsertChannelLevel.mockResolvedValue({
        user_id: 'user-1',
        chapter_id: 'ch-1',
        scope: 'channel',
        scope_id: 'ch-chan-1',
        scope_kind: null,
        level: 'off',
      });

      const result = await service.setChannelNotificationLevel(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'off',
      );

      expect(mockChatNotificationPrefs.upsertChannelLevel).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        'ch-chan-1',
        'off',
      );
      expect(result).toEqual({ channel_id: 'ch-chan-1', level: 'off' });
    });

    /**
     * The security property of this endpoint. `chat_channels` has RLS enabled
     * with no policies (#1009) and the API holds the `service_role` key, so
     * this application-layer check is the only thing preventing a caller from
     * writing a preference row about a channel they cannot read — which would
     * confirm that channel id exists.
     */
    it('refuses to write a preference for a channel the caller cannot access', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        id: 'ch-private',
        type: 'PRIVATE',
        member_ids: ['someone-else'],
      });

      await expect(
        service.setChannelNotificationLevel(
          'ch-private',
          'ch-1',
          'user-1',
          'off',
        ),
      ).rejects.toThrow();

      expect(
        mockChatNotificationPrefs.upsertChannelLevel,
      ).not.toHaveBeenCalled();
    });

    it('refuses for a channel that does not exist in the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.setChannelNotificationLevel(
          'ch-missing',
          'ch-1',
          'user-1',
          'all',
        ),
      ).rejects.toThrow();

      expect(
        mockChatNotificationPrefs.upsertChannelLevel,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getChannelNotificationPreferences', () => {
    const announcements: ChatChannel = {
      ...baseChannel,
      id: 'ch-ann',
      name: 'announcements',
    };
    const audit: ChatChannel = {
      ...baseChannel,
      id: 'ch-audit',
      name: 'chapter-audit',
    };

    /**
     * The endpoint answers "what will this channel actually do", not "what rows
     * exist". Returning only stored rows made the web control assume `mentions`
     * everywhere, which is wrong for the two channels `DEFAULT_CHANNELS` seeds
     * into every chapter — and the popover then swallowed the corrective click
     * because the option it showed as current already looked selected.
     */
    it('resolves every accessible channel to its effective level, not just stored rows', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([
        baseChannel,
        announcements,
        audit,
      ]);

      const result = await service.getChannelNotificationPreferences(
        'ch-1',
        'user-1',
      );

      expect(result).toEqual([
        { channel_id: 'ch-chan-1', level: 'mentions' },
        { channel_id: 'ch-ann', level: 'all' },
        { channel_id: 'ch-audit', level: 'off' },
      ]);
    });

    it('lets a stored row override the channel default', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [
          {
            user_id: 'user-1',
            chapter_id: 'ch-1',
            scope: 'channel',
            scope_id: 'ch-ann',
            scope_kind: null,
            level: 'off',
          },
        ],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([
        baseChannel,
        announcements,
      ]);

      const result = await service.getChannelNotificationPreferences(
        'ch-1',
        'user-1',
      );

      // `announcements` defaults to `all`; the stored `off` must win.
      expect(result).toEqual([
        { channel_id: 'ch-chan-1', level: 'mentions' },
        { channel_id: 'ch-ann', level: 'off' },
      ]);
    });

    /**
     * The negative control for the authorization filter.
     *
     * This deliberately models a channel that **exists in the chapter and is
     * unreadable**, not one that has been deleted. An earlier version of this
     * test omitted the channel from `findByChapter` entirely, which made it
     * invisible before the read predicate ever ran — so it would still have
     * passed if the predicate were downgraded to plain chapter scoping, and it
     * did not test the thing the service comment and the spec both justify the
     * filter with ("a preference row survives losing access to its channel").
     *
     * `ch-secret` is PRIVATE with a `member_ids` the caller is not in, so only
     * `canAccessChannel` excludes it. Negative-controlled: replacing
     * `filterAccessibleChannels` with a chapter-only filter fails this test.
     */
    it('excludes a channel that exists in the chapter but the caller cannot read', async () => {
      const secret: ChatChannel = {
        ...baseChannel,
        id: 'ch-secret',
        name: 'exec-only',
        type: 'PRIVATE',
        member_ids: ['someone-else'],
      };
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [
          {
            user_id: 'user-1',
            chapter_id: 'ch-1',
            scope: 'channel',
            scope_id: 'ch-secret',
            scope_kind: null,
            level: 'off',
          },
        ],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([baseChannel, secret]);

      const result = await service.getChannelNotificationPreferences(
        'ch-1',
        'user-1',
      );

      expect(result).toEqual([{ channel_id: 'ch-chan-1', level: 'mentions' }]);
      expect(result.some((r) => r.channel_id === 'ch-secret')).toBe(false);
    });

    it('returns an empty list when the caller can read no channels', async () => {
      mockChatNotificationPrefs.findChannelPreferencesForUser.mockResolvedValue(
        [],
      );
      mockChannelRepo.findByChapter.mockResolvedValue([]);

      await expect(
        service.getChannelNotificationPreferences('ch-1', 'user-1'),
      ).resolves.toEqual([]);
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
        // The seeded shape: everyone reads, only `announcements:post` writes.
        is_read_only: true,
      };
      mockMessageRepo.create.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue(announcementChannel);
      // A read-only channel is postable only with the permission — which is the
      // point: `announcements:post` is what authorizes an announcement.
      mockRbac.getEffectivePermissions.mockResolvedValue([
        'announcements:post',
      ]);

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

    // #1008: the fan-out pushes the message body to EVERY chapter member, so it
    // is only sound where every member can read the channel. Matching on the
    // name alone, a PRIVATE channel named `exec-announcements` — newly postable
    // once its creator is seeded — would have broadcast its contents chapter-wide.
    it.each(['PRIVATE', 'ROLE_GATED'] as const)(
      'should not fan an announcement-named %s channel out to the chapter',
      async (type) => {
        mockMessageRepo.create.mockResolvedValue(baseMessage);
        mockChannelRepo.findById.mockResolvedValue({
          ...baseChannel,
          name: 'exec-announcements',
          type,
          member_ids: type === 'PRIVATE' ? ['user-1'] : null,
          required_permissions: type === 'ROLE_GATED' ? ['roles:manage'] : null,
        });
        // The sender must be able to POST for the notification to be reached at
        // all; the point of the test is what happens after that, not the gate.
        if (type === 'ROLE_GATED') {
          mockRbac.getEffectivePermissions.mockResolvedValue(['roles:manage']);
        }

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Private exec discussion',
        });

        expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
      },
    );

    // A PUBLIC channel anyone can post to must not be able to fan an URGENT,
    // quiet-hours-exempt push to the whole roster just because it is named
    // `*-announcements`. `announcements:post` is what governs authorship.
    it('should not fan out from a PUBLIC channel that is not read-only', async () => {
      mockMessageRepo.create.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        name: 'intramural-announcements',
        type: 'PUBLIC',
        is_read_only: false,
      });

      await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'anyone can post this',
      });

      expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
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

    describe('poll-card vote validation (#871)', () => {
      // The card payload the composer writes (@repo/chat-core/dispatch):
      // options carry ids, and the deadline is `closes_at`.
      const pollMessage = {
        ...baseMessage,
        kind: 'poll',
        payload: {
          question: 'Formal venue?',
          options: [
            { id: 'opt-a', label: 'The Lodge' },
            { id: 'opt-b', label: 'Riverside' },
          ],
          closes_at: null,
        },
      };

      const vote = (payload: Record<string, unknown>) =>
        service.recordMessageAction('msg-1', 'ch-1', 'user-1', {
          action_type: 'vote',
          payload,
        });

      it('rejects a vote on a closed poll', async () => {
        mockMessageRepo.findById.mockResolvedValue({
          ...pollMessage,
          payload: {
            ...pollMessage.payload,
            closes_at: '2020-01-01T00:00:00.000Z',
          },
        });

        await expect(vote({ option_id: 'opt-a' })).rejects.toThrow(
          BadRequestException,
        );
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('rejects an option that is not on the card', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);

        await expect(vote({ option_id: 'opt-z' })).rejects.toThrow(
          /Invalid option/,
        );
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('rejects several selections on a single-choice card', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);

        await expect(vote({ option_id: ['opt-a', 'opt-b'] })).rejects.toThrow(
          /exactly one option/,
        );
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('still records a valid vote', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);
        mockActionRepo.create.mockResolvedValue({
          ...baseAction,
          action_type: 'vote',
        });

        await expect(vote({ option_id: 'opt-a' })).resolves.toMatchObject({
          deduplicated: false,
        });
        expect(mockActionRepo.create).toHaveBeenCalled();
      });

      it('leaves non-vote actions on a poll card alone', async () => {
        // Reactions on a poll card are not votes and must not be rule-checked.
        mockMessageRepo.findById.mockResolvedValue(pollMessage);
        mockActionRepo.create.mockResolvedValue(baseAction);

        await expect(
          service.recordMessageAction('msg-1', 'ch-1', 'user-1', {
            action_type: 'reaction:👍',
          }),
        ).resolves.toMatchObject({ deduplicated: false });
      });
    });

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
  describe('getUnreadCounts', () => {
    const PRIVATE_OTHERS: ChatChannel = {
      ...baseChannel,
      id: 'private-not-mine',
      name: 'their-dm',
      type: 'PRIVATE',
      member_ids: ['someone-else', 'another'],
    };

    it('drops channels the caller cannot read', async () => {
      // The RPC answers for every channel in the chapter on purpose, so this
      // filter is the only thing standing between a member and the knowledge
      // that two other members have an active private conversation. An unread
      // count alone is enough to leak that.
      mockChannelRepo.findByChapter.mockResolvedValue([
        baseChannel,
        PRIVATE_OTHERS,
      ]);
      mockReadReceiptRepo.getUnreadCounts.mockResolvedValue([
        { channel_id: baseChannel.id, unread_count: 3, mention_count: 1 },
        { channel_id: PRIVATE_OTHERS.id, unread_count: 9, mention_count: 4 },
      ]);

      const result = await service.getUnreadCounts('ch-1', 'user-1');

      expect(result).toEqual([
        { channel_id: baseChannel.id, unread_count: 3, mention_count: 1 },
      ]);
    });

    it('keeps a readable channel with nothing unread rather than dropping it', async () => {
      // The list needs a row per channel to render; a zero is a real answer.
      mockChannelRepo.findByChapter.mockResolvedValue([baseChannel]);
      mockReadReceiptRepo.getUnreadCounts.mockResolvedValue([
        { channel_id: baseChannel.id, unread_count: 0, mention_count: 0 },
      ]);

      await expect(service.getUnreadCounts('ch-1', 'user-1')).resolves.toEqual([
        { channel_id: baseChannel.id, unread_count: 0, mention_count: 0 },
      ]);
    });

    it('does not consult the access filter when the RPC returns nothing', async () => {
      mockReadReceiptRepo.getUnreadCounts.mockResolvedValue([]);

      await expect(service.getUnreadCounts('ch-1', 'user-1')).resolves.toEqual(
        [],
      );
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('returns nothing for a non-member rather than the whole chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockChannelRepo.findByChapter.mockResolvedValue([baseChannel]);
      mockReadReceiptRepo.getUnreadCounts.mockResolvedValue([
        { channel_id: baseChannel.id, unread_count: 5, mention_count: 0 },
      ]);

      await expect(service.getUnreadCounts('ch-1', 'ghost')).resolves.toEqual(
        [],
      );
    });
  });

  describe('sendMessage — mention resolution', () => {
    const roster = [
      { user_id: 'user-1', display_name: 'Sender One' },
      { user_id: 'user-2', display_name: 'Jane Doe' },
      { user_id: 'user-3', display_name: 'Janet Roe' },
    ];

    function seedRoster() {
      mockMemberRepo.findChapterMemberIdentities.mockResolvedValue(roster);
    }

    it('resolves a mention server-side and stores users.id', async () => {
      seedRoster();
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content: 'hey @janedoe can you cover?',
      });

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: ['user-2'] }),
      );
    });

    it('stores no mention when the token is ambiguous', async () => {
      // "jan" prefixes both Jane and Janet. Guessing would notify the wrong
      // member, and mentions override a per-channel mute — so it fails closed.
      seedRoster();
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content: '@jan you around?',
      });

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [] }),
      );
    });

    it('never trusts a client-supplied mention list', async () => {
      // The whole point of resolving server-side: a forged list would let any
      // member push to any other member in a channel they had muted.
      seedRoster();
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content: 'no mentions here',
        metadata: { mentions: ['user-2', 'user-3'] },
      });

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [] }),
      );
    });

    it('skips the roster lookup entirely when the body has no @', async () => {
      seedRoster();
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content: 'plain message',
      });

      expect(mockMemberRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('re-resolves mentions on edit', async () => {
      // Without this the stored list describes text that no longer exists:
      // editing someone in never counts toward their badge, and editing them
      // out leaves a mention of a message that no longer names them.
      seedRoster();
      mockMessageRepo.update.mockResolvedValue(baseMessage);

      await service.editMessage('msg-1', 'ch-1', 'user-1', 'now with @janedoe');

      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ mentions: ['user-2'] }),
      );
    });

    it('clears mentions when an edit removes them', async () => {
      seedRoster();
      mockMessageRepo.update.mockResolvedValue(baseMessage);

      await service.editMessage('msg-1', 'ch-1', 'user-1', 'never mind');

      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ mentions: [] }),
      );
    });

    it('still sends when the directory lookup fails', async () => {
      // Losing a highlight is acceptable; losing the message is not.
      mockMemberRepo.findChapterMemberIdentities.mockRejectedValue(
        new Error('directory down'),
      );
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await expect(
        service.sendMessage({
          channel_id: 'ch-chan-1',
          chapter_id: 'ch-1',
          sender_id: 'user-1',
          content: 'hey @janedoe',
        }),
      ).resolves.toBeDefined();

      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [] }),
      );
    });

    // ── #986: the roster fetch is no longer paid per `@` ──────────────────

    it.each([
      ['an email address', 'ping me at paul@example.com'],
      ['a bare @ in prose', 'email me @ noon'],
      ['a leading-@ handle with no letter', 'weird @123 token'],
    ])('issues no roster query for %s', async (_label, content) => {
      // The old gate was `content.includes('@')`, so each of these bought a
      // full chapter roster fetch — plus a second query for every user row —
      // on the send hot path. None of them can resolve to a member.
      seedRoster();
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content,
      });

      expect(mockMemberRepo.findChapterMemberIdentities).not.toHaveBeenCalled();
      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [] }),
      );
    });

    it('resolves a mention in exactly one query', async () => {
      // AC #2. Pinned as a count, not just a shape: the regression this guards
      // is someone reintroducing a roster-then-hydrate pair, which resolves the
      // same mentions and would pass every other test in this block.
      seedRoster();
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content: 'hey @janedoe can you cover?',
      });

      expect(mockMemberRepo.findChapterMemberIdentities).toHaveBeenCalledTimes(
        1,
      );
      expect(mockMemberRepo.findChapterMemberIdentities).toHaveBeenCalledWith(
        'ch-1',
      );
      // The wide roster read is gone from this path entirely.
      expect(mockMemberRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('scopes candidates to the sending chapter', async () => {
      // AC #3. The chapter predicate lives in the repository join now, so the
      // guarantee this pins is that the service still passes the *sending*
      // chapter and never a wider set — a member must not be able to mention
      // someone outside their chapter, since a mention overrides a mute.
      mockMemberRepo.findChapterMemberIdentities.mockResolvedValue([]);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      await service.sendMessage({
        channel_id: 'ch-chan-1',
        chapter_id: 'ch-1',
        sender_id: 'user-1',
        content: 'hey @janedoe',
      });

      expect(mockMemberRepo.findChapterMemberIdentities).toHaveBeenCalledWith(
        'ch-1',
      );
      expect(mockMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mentions: [] }),
      );
    });

    it('issues no roster query when an edit removes the last mention', async () => {
      // The edit path re-resolves against the new body, so it inherits the same
      // early return. The new body deliberately still contains an `@` — under
      // the old `content.includes('@')` gate this edit bought a full roster
      // fetch, so a body without one would let this pass either way.
      seedRoster();
      mockMessageRepo.update.mockResolvedValue(baseMessage);

      await service.editMessage(
        'msg-1',
        'ch-1',
        'user-1',
        'never mind, reach me @ 5pm',
      );

      expect(mockMemberRepo.findChapterMemberIdentities).not.toHaveBeenCalled();
      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ mentions: [] }),
      );
    });
  });
});
