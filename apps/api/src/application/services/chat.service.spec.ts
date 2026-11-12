import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CHAT_SINCE_NOT_FOUND_CODE,
  moduleDisabledMessage,
} from '@repo/validation';
import {
  canAccessChannel,
  EMPTY_ACCESS_HOLDER,
  type ChannelAccessHolder,
} from '#domain/utils/channel-access';
import { tombstoneMetadata } from './chat-block-mask';
import { ChatService } from './chat.service';
import { ChatAttachmentService } from './chat-attachment.service';
import {
  baseChannel,
  baseMember,
  baseMessage,
  createChatServiceFixture,
  type ChatServiceFixture,
} from '#test/helpers/chat-service.fixture';
import {
  ChatMessageCursorNotFoundError,
  ChatMessageDuplicateError,
} from '#domain/repositories/chat.repository.interface';
import type { ChatChannel, ChatMessage } from '#domain/entities/chat.entity';
import { ReportedMessageGrant } from './channel-access.service';
import type { ChatMessageReportView } from '#domain/entities/chat-moderation.entity';
import { BLOCKED_MESSAGE_CONTENT } from './chat-block-mask';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';

describe('ChatService', () => {
  let service: ChatService;
  let attachments: ChatAttachmentService;
  let mockChannelRepo: ChatServiceFixture['mockChannelRepo'];
  let mockMessageRepo: ChatServiceFixture['mockMessageRepo'];
  let mockAttachmentRepo: ChatServiceFixture['mockAttachmentRepo'];
  let mockReadReceiptRepo: ChatServiceFixture['mockReadReceiptRepo'];
  let mockStorageProvider: ChatServiceFixture['mockStorageProvider'];
  let mockMemberRepo: ChatServiceFixture['mockMemberRepo'];
  let mockActivation: ChatServiceFixture['mockActivation'];
  let mockChannelCache: ChatServiceFixture['mockChannelCache'];
  let mockRbac: ChatServiceFixture['mockRbac'];
  let mockChatBlocks: ChatServiceFixture['mockChatBlocks'];
  let mockReportRepo: ChatServiceFixture['mockReportRepo'];
  let mockNotificationService: ChatServiceFixture['mockNotificationService'];
  let mockRoleRepo: ChatServiceFixture['mockRoleRepo'];
  let mockTierRepo: ChatServiceFixture['mockTierRepo'];
  let mockCategoryRepo: ChatServiceFixture['mockCategoryRepo'];
  beforeEach(async () => {
    ({
      service,
      attachments,
      mockChannelRepo,
      mockMessageRepo,
      mockAttachmentRepo,
      mockReadReceiptRepo,
      mockStorageProvider,
      mockMemberRepo,
      mockActivation,
      mockChannelCache,
      mockRbac,
      mockChatBlocks,
      mockReportRepo,
      mockNotificationService,
      mockRoleRepo,
      mockTierRepo,
      mockCategoryRepo,
    } = await createChatServiceFixture());
  });

  // A role and a tier of chapter `ch-1`, as a who-can-see or who-can-post
  // list names them (#3722).
  const EXEC_ROLE = '00000000-0000-4000-8000-00000000e0e0';
  const EXEC_TIER = '00000000-0000-4000-8000-0000000071e1';
  const OFFICERS = `tier:${EXEC_TIER}`;
  const holderOf = (...entries: string[]): ChannelAccessHolder => ({
    ...EMPTY_ACCESS_HOLDER,
    entries: new Set(entries),
  });
  const WILDCARD: ChannelAccessHolder = {
    ...EMPTY_ACCESS_HOLDER,
    wildcard: true,
  };
  const ALUMNI_ROLE = '00000000-0000-4000-8000-0000000a1a11';
  const ALUMNUS: ChannelAccessHolder = {
    ...holderOf(`role:${ALUMNI_ROLE}`),
    alumniEntries: new Set([`role:${ALUMNI_ROLE}`]),
  };
  // The chapter's announcements channel (`isAnnouncementChannel`), postable by
  // the officers on its who-can-post list: the only place an announcement
  // card may be posted (#3414). `asAnnouncer` makes the sender one of them.
  const announcementsChannel: ChatChannel = {
    ...baseChannel,
    name: 'announcements',
    is_read_only: true,
    who_can_post: [OFFICERS],
  };
  const asAnnouncer = () => {
    mockChannelRepo.findById.mockResolvedValue(announcementsChannel);
    mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(OFFICERS));
  };

  const withChapterRolesAndTiers = () => {
    mockRoleRepo.findByChapter.mockResolvedValue([
      { id: EXEC_ROLE, chapter_id: 'ch-1', tier_id: EXEC_TIER },
    ]);
    mockTierRepo.findByChapter.mockResolvedValue([
      { id: EXEC_TIER, chapter_id: 'ch-1' },
    ]);
  };

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

    it('records the creator and Always formal (#3787)', async () => {
      mockChannelRepo.create.mockResolvedValue(baseChannel);

      await service.createChannel(
        {
          chapter_id: 'ch-1',
          name: 'announcements-2',
          type: 'PUBLIC',
          display_locked: true,
        },
        'u-creator',
      );

      expect(mockChannelRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          created_by: 'u-creator',
          display_locked: true,
        }),
      );
    });

    it('leaves a new channel unlocked by default', async () => {
      mockChannelRepo.create.mockResolvedValue(baseChannel);

      await service.createChannel(
        { chapter_id: 'ch-1', name: 'random', type: 'PUBLIC' },
        'u-creator',
      );

      expect(mockChannelRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ display_locked: false }),
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

    // A channel only some can see needs a list of who: ROLE_GATED with no
    // who-can-see list, or an empty one, would be a channel nobody but the
    // President can open.
    it.each([undefined, []])(
      'should reject a ROLE_GATED channel with who_can_see %p',
      async (whoCanSee) => {
        await expect(
          service.createChannel(
            {
              chapter_id: 'ch-1',
              name: 'exec-board',
              type: 'ROLE_GATED',
              who_can_see: whoCanSee,
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
        Promise.resolve({ ...baseChannel, ...data }),
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
          holder: EMPTY_ACCESS_HOLDER,
        }),
      ).toBe(true);
    });

    // A PRIVATE channel is not a public one: seeding the creator must not make
    // it readable by another chapter member.
    it('should not make a seeded PRIVATE channel readable by anyone else', async () => {
      mockChannelRepo.create.mockImplementation((data) =>
        Promise.resolve({ ...baseChannel, ...data }),
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
          holder: { ...EMPTY_ACCESS_HOLDER, wildcard: true },
        }),
      ).toBe(false);
    });

    // PUBLIC and ROLE_GATED resolve access by who can see; a membership list
    // there would imply something that is never consulted.
    it.each(['PUBLIC', 'ROLE_GATED'] as const)(
      'should not seed member_ids on a %s channel',
      async (type) => {
        withChapterRolesAndTiers();
        mockChannelRepo.create.mockResolvedValue(baseChannel);

        await service.createChannel(
          {
            chapter_id: 'ch-1',
            name: 'general',
            type,
            who_can_see:
              type === 'ROLE_GATED' ? [`role:${EXEC_ROLE}`] : undefined,
          },
          'u-creator',
        );

        expect(mockChannelRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ member_ids: null }),
        );
      },
    );

    describe('who can see and post (#3722)', () => {
      it('writes the lists sent, sorted, with type and read-only to match', async () => {
        withChapterRolesAndTiers();
        mockChannelRepo.create.mockResolvedValue(baseChannel);

        await service.createChannel(
          {
            chapter_id: 'ch-1',
            name: 'exec-board',
            type: 'PUBLIC',
            who_can_see: [`role:${EXEC_ROLE}`, `tier:${EXEC_TIER}`],
            who_can_post: [`TIER:${EXEC_TIER}`.toLowerCase()],
          },
          'u-creator',
        );

        expect(mockChannelRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ROLE_GATED',
            who_can_see: [`role:${EXEC_ROLE}`, `tier:${EXEC_TIER}`],
            who_can_post: [`tier:${EXEC_TIER}`],
            is_read_only: true,
          }),
        );
        const written = mockChannelRepo.create.mock.calls[0][0];
        expect(written).not.toHaveProperty('required_permissions');
      });

      it("copies its category's lists for a list it leaves out", async () => {
        withChapterRolesAndTiers();
        mockChannelRepo.create.mockResolvedValue(baseChannel);
        mockCategoryRepo.findById.mockResolvedValue({
          id: 'cat-1',
          chapter_id: 'ch-1',
          name: 'Exec',
          display_order: 0,
          created_at: '',
          who_can_see: [`tier:${EXEC_TIER}`],
          who_can_post: null,
        });

        await service.createChannel(
          {
            chapter_id: 'ch-1',
            name: 'budget',
            type: 'PUBLIC',
            category_id: 'cat-1',
          },
          'u-creator',
        );

        expect(mockCategoryRepo.findById).toHaveBeenCalledWith('cat-1', 'ch-1');
        expect(mockChannelRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ROLE_GATED',
            who_can_see: [`tier:${EXEC_TIER}`],
            who_can_post: null,
            is_read_only: false,
          }),
        );
      });

      it('is everyone with no lists and no category', async () => {
        mockChannelRepo.create.mockResolvedValue(baseChannel);

        await service.createChannel(
          { chapter_id: 'ch-1', name: 'random', type: 'PUBLIC' },
          'u-creator',
        );

        expect(mockChannelRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'PUBLIC',
            who_can_see: null,
            who_can_post: null,
            is_read_only: false,
          }),
        );
      });

      it("refuses an entry that isn't a tier or role of this chapter", async () => {
        withChapterRolesAndTiers();

        await expect(
          service.createChannel(
            {
              chapter_id: 'ch-1',
              name: 'exec',
              type: 'PUBLIC',
              who_can_see: ['role:00000000-0000-4000-8000-0000000000ff'],
            },
            'u-creator',
          ),
        ).rejects.toThrow("That role isn't in this chapter anymore");
        expect(mockChannelRepo.create).not.toHaveBeenCalled();
      });

      it('refuses lists on a private channel, which its members decide', async () => {
        withChapterRolesAndTiers();

        await expect(
          service.createChannel(
            {
              chapter_id: 'ch-1',
              name: 'secret',
              type: 'PRIVATE',
              who_can_see: [`role:${EXEC_ROLE}`],
            },
            'u-creator',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      // A page left open across the deploy still sends the old fields.
      it.each([
        { required_permissions: ['roles:manage'] },
        { is_read_only: true },
      ])('refuses an old page that sends %p', async (legacy) => {
        await expect(
          service.createChannel(
            { chapter_id: 'ch-1', name: 'x', type: 'PUBLIC', ...legacy },
            'u-creator',
          ),
        ).rejects.toThrow('Reload the page');
        expect(mockChannelRepo.create).not.toHaveBeenCalled();
      });

      it("accepts an old page's create that changes nothing about access", async () => {
        mockChannelRepo.create.mockResolvedValue(baseChannel);

        await service.createChannel(
          {
            chapter_id: 'ch-1',
            name: 'x',
            type: 'PUBLIC',
            is_read_only: false,
          },
          'u-creator',
        );

        expect(mockChannelRepo.create).toHaveBeenCalled();
      });
    });
  });

  describe('updateChannel', () => {
    const roleGated = {
      ...baseChannel,
      type: 'ROLE_GATED' as const,
      who_can_see: [`tier:${EXEC_TIER}`],
    };

    it('should leave the stored lists intact when neither is sent', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGated);
      mockChannelRepo.update.mockResolvedValue(roleGated);

      await service.updateChannel('chan-1', 'ch-1', { name: 'renamed' });

      expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
        name: 'renamed',
      });
    });

    describe('who can see and post (#3722)', () => {
      it('writes a list sent and keeps the other', async () => {
        withChapterRolesAndTiers();
        mockChannelRepo.findById.mockResolvedValue(roleGated);
        mockChannelRepo.update.mockResolvedValue(roleGated);

        await service.updateChannel('chan-1', 'ch-1', {
          who_can_post: [`role:${EXEC_ROLE}`],
        });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          type: 'ROLE_GATED',
          who_can_see: [`tier:${EXEC_TIER}`],
          who_can_post: [`role:${EXEC_ROLE}`],
          is_read_only: true,
        });
        expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-1');
      });

      it('opens a channel to everyone with null', async () => {
        mockChannelRepo.findById.mockResolvedValue(roleGated);
        mockChannelRepo.update.mockResolvedValue(baseChannel);

        await service.updateChannel('chan-1', 'ch-1', { who_can_see: null });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          type: 'PUBLIC',
          who_can_see: null,
          who_can_post: null,
          is_read_only: false,
        });
      });

      // A private channel made read-only before #3722 keeps its posters as a
      // list (migration 20261111233000): an officer may clear it, not set one.
      it('clears a read-only private channel and refuses setting one', async () => {
        const locked = {
          ...baseChannel,
          type: 'PRIVATE' as const,
          member_ids: ['u-1'],
          who_can_post: [`role:${EXEC_ROLE}`],
          is_read_only: true,
        };
        mockChannelRepo.findById.mockResolvedValue(locked);
        mockChannelRepo.update.mockResolvedValue(locked);

        await service.updateChannel('chan-1', 'ch-1', { who_can_post: null });
        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          who_can_post: null,
          is_read_only: false,
        });

        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            who_can_post: [`role:${EXEC_ROLE}`],
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('refuses an empty list', async () => {
        mockChannelRepo.findById.mockResolvedValue(roleGated);

        await expect(
          service.updateChannel('chan-1', 'ch-1', { who_can_see: [] }),
        ).rejects.toThrow('Pick at least one tier or role');
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
        expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
      });

      it('matches the category: copies the lists of the category it ends up in', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...roleGated,
          category_id: 'cat-old',
        });
        mockChannelRepo.update.mockResolvedValue(baseChannel);
        mockCategoryRepo.findById.mockResolvedValue({
          id: 'cat-new',
          chapter_id: 'ch-1',
          name: 'Chapter',
          display_order: 0,
          created_at: '',
          who_can_see: null,
          who_can_post: [`tier:${EXEC_TIER}`],
        });

        await service.updateChannel('chan-1', 'ch-1', {
          category_id: 'cat-new',
          match_category_access: true,
        });

        expect(mockCategoryRepo.findById).toHaveBeenCalledWith(
          'cat-new',
          'ch-1',
        );
        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          category_id: 'cat-new',
          type: 'PUBLIC',
          who_can_see: null,
          who_can_post: [`tier:${EXEC_TIER}`],
          is_read_only: true,
        });
      });

      it('keeps its lists when it moves to another category', async () => {
        mockChannelRepo.findById.mockResolvedValue(roleGated);
        mockChannelRepo.update.mockResolvedValue(roleGated);
        mockCategoryRepo.findById.mockResolvedValue({
          id: 'cat-2',
          chapter_id: 'ch-1',
          name: 'Chapter',
          display_order: 0,
          created_at: '',
          who_can_see: [`tier:${EXEC_TIER}`],
          who_can_post: null,
        });

        await service.updateChannel('chan-1', 'ch-1', { category_id: 'cat-2' });

        // Looked up only to check it is this chapter's; its lists aren't copied.
        expect(mockCategoryRepo.findById).toHaveBeenCalledWith('cat-2', 'ch-1');
        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          category_id: 'cat-2',
        });
      });

      it("refuses a move into another chapter's category, writing nothing", async () => {
        mockChannelRepo.findById.mockResolvedValue(roleGated);
        // Scoped to this chapter, so another chapter's category isn't found.
        mockCategoryRepo.findById.mockResolvedValue(null);

        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            category_id: 'cat-other-chapter',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(mockCategoryRepo.findById).toHaveBeenCalledWith(
          'cat-other-chapter',
          'ch-1',
        );
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
        expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
      });

      it("refuses a new channel in another chapter's category, writing nothing", async () => {
        mockCategoryRepo.findById.mockResolvedValue(null);

        await expect(
          service.createChannel(
            {
              chapter_id: 'ch-1',
              name: 'budget',
              type: 'PUBLIC',
              category_id: 'cat-other-chapter',
            },
            'u-creator',
          ),
        ).rejects.toThrow(NotFoundException);
        expect(mockChannelRepo.create).not.toHaveBeenCalled();
      });

      it('refuses matching with no category, or with lists sent too', async () => {
        mockChannelRepo.findById.mockResolvedValue(roleGated);

        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            match_category_access: true,
          }),
        ).rejects.toThrow("This channel isn't in a category");
        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            match_category_access: true,
            who_can_see: null,
          }),
        ).rejects.toThrow('not both');
      });

      it.each(['PRIVATE', 'DM', 'GROUP_DM'] as const)(
        'refuses lists on a %s, which its members decide',
        async (type) => {
          mockChannelRepo.findById.mockResolvedValue({
            ...baseChannel,
            type,
            member_ids: ['user-1'],
          });

          await expect(
            service.updateChannel('chan-1', 'ch-1', { who_can_see: null }),
          ).rejects.toThrow(BadRequestException);
          expect(mockChannelRepo.update).not.toHaveBeenCalled();
        },
      );

      it('refuses an old page that sends required_permissions', async () => {
        mockChannelRepo.findById.mockResolvedValue(roleGated);

        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            required_permissions: ['roles:manage'],
          }),
        ).rejects.toThrow('Reload the page');
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
      });

      it('refuses an old page that flips read-only, and ignores one that repeats it', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.update.mockResolvedValue(baseChannel);

        await expect(
          service.updateChannel('chan-1', 'ch-1', { is_read_only: true }),
        ).rejects.toThrow('Reload the page');

        await service.updateChannel('chan-1', 'ch-1', {
          is_read_only: false,
          name: 'random',
        });
        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          name: 'random',
        });
      });
    });

    describe('Leave out of Activity (#3897)', () => {
      it('saves it on a chapter channel', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.update.mockResolvedValue({
          ...baseChannel,
          activity_excluded: true,
        });

        await service.updateChannel('chan-1', 'ch-1', {
          activity_excluded: true,
        });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          activity_excluded: true,
        });
      });

      it.each(['DM', 'GROUP_DM'] as const)(
        'refuses it on a %s, which has no officer',
        async (type) => {
          mockChannelRepo.findById.mockResolvedValue({ ...baseChannel, type });

          await expect(
            service.updateChannel('chan-1', 'ch-1', {
              activity_excluded: true,
            }),
          ).rejects.toThrow("A DM or group DM can't be left out of Activity");
          expect(mockChannelRepo.update).not.toHaveBeenCalled();
        },
      );
    });

    describe('the audit log channel (#3909)', () => {
      const auditLog = {
        ...baseChannel,
        name: 'chapter-audit',
        is_read_only: true,
        who_can_post: [],
        is_audit_log: true,
      };

      it('refuses switching read-only off', async () => {
        mockChannelRepo.findById.mockResolvedValue(auditLog);

        await expect(
          service.updateChannel('chan-1', 'ch-1', { is_read_only: false }),
        ).rejects.toThrow('The audit log channel is always read-only');
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
      });

      it('refuses a rename', async () => {
        mockChannelRepo.findById.mockResolvedValue(auditLog);

        await expect(
          service.updateChannel('chan-1', 'ch-1', { name: 'officer-log' }),
        ).rejects.toThrow("The audit log channel can't be renamed");
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
      });

      it('still saves its description, and a save that repeats its name and read-only', async () => {
        mockChannelRepo.findById.mockResolvedValue(auditLog);
        mockChannelRepo.update.mockResolvedValue(auditLog);

        await service.updateChannel('chan-1', 'ch-1', {
          name: 'chapter-audit',
          is_read_only: true,
          description: 'Every officer change, posted by Frapp.',
        });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          name: 'chapter-audit',
          description: 'Every officer change, posted by Frapp.',
        });
      });

      it('refuses who-can-see and who-can-post lists', async () => {
        mockChannelRepo.findById.mockResolvedValue(auditLog);

        await expect(
          service.updateChannel('chan-1', 'ch-1', { who_can_post: null }),
        ).rejects.toThrow('Everyone sees the audit log channel');
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
      });
    });

    describe('default_notification_level (#2771)', () => {
      it('passes an officer-set default through, and evicts the push cache', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.update.mockResolvedValue(baseChannel);
        await service.updateChannel('chan-1', 'ch-1', {
          default_notification_level: 'mentions',
        });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          default_notification_level: 'mentions',
        });
        // The worker reads this column from its channel cache, so a change
        // that did not evict would keep pushing on the old default.
        expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-1');
      });

      it('passes null through, which clears it back to the built-in default', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.update.mockResolvedValue(baseChannel);

        await service.updateChannel('chan-1', 'ch-1', {
          default_notification_level: null,
        });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          default_notification_level: null,
        });
      });

      it.each(['DM', 'GROUP_DM'] as const)(
        'refuses a default on a %s, which always defaults to all',
        async (type) => {
          mockChannelRepo.findById.mockResolvedValue({
            ...baseChannel,
            type,
            member_ids: ['user-1', 'user-2'],
          });

          await expect(
            service.updateChannel('chan-1', 'ch-1', {
              default_notification_level: 'off',
            }),
          ).rejects.toThrow(BadRequestException);
          expect(mockChannelRepo.update).not.toHaveBeenCalled();
        },
      );
    });

    describe('is_default (the chapter default channel)', () => {
      const asDefault = { ...baseChannel, is_default: true };

      it('sets it through the one-transaction swap, after the plain fields', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.update.mockResolvedValue({
          ...baseChannel,
          name: 'renamed',
        });
        mockChannelRepo.setDefault.mockResolvedValue({
          ...asDefault,
          name: 'renamed',
        });

        const result = await service.updateChannel('chan-1', 'ch-1', {
          name: 'renamed',
          is_default: true,
        });

        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          name: 'renamed',
        });
        expect(mockChannelRepo.setDefault).toHaveBeenCalledWith(
          'chan-1',
          'ch-1',
        );
        expect(mockChannelRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
          mockChannelRepo.setDefault.mock.invocationCallOrder[0],
        );
        expect(result.is_default).toBe(true);
      });

      it('skips the plain update when the default is all that changed', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.setDefault.mockResolvedValue(asDefault);

        await service.updateChannel('chan-1', 'ch-1', { is_default: true });

        expect(mockChannelRepo.update).not.toHaveBeenCalled();
        expect(mockChannelRepo.setDefault).toHaveBeenCalled();
      });

      it('never moves the default when the save is refused', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...baseChannel,
          type: 'ROLE_GATED',
          who_can_see: [OFFICERS],
        });

        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            who_can_see: [],
            is_default: true,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockChannelRepo.setDefault).not.toHaveBeenCalled();
      });

      it('never moves the default when the plain update fails', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockChannelRepo.update.mockRejectedValue(new Error('name taken'));

        await expect(
          service.updateChannel('chan-1', 'ch-1', {
            name: 'general',
            is_default: true,
          }),
        ).rejects.toThrow('name taken');
        expect(mockChannelRepo.setDefault).not.toHaveBeenCalled();
      });

      it('leaves the default alone when this channel already holds it', async () => {
        mockChannelRepo.findById.mockResolvedValue(asDefault);

        await service.updateChannel('chan-1', 'ch-1', { is_default: true });

        expect(mockChannelRepo.setDefault).not.toHaveBeenCalled();
      });

      it('unsets it with a plain update', async () => {
        mockChannelRepo.findById.mockResolvedValue(asDefault);
        mockChannelRepo.update.mockResolvedValue(baseChannel);

        await service.updateChannel('chan-1', 'ch-1', { is_default: false });

        expect(mockChannelRepo.setDefault).not.toHaveBeenCalled();
        expect(mockChannelRepo.update).toHaveBeenCalledWith('chan-1', 'ch-1', {
          is_default: false,
        });
      });

      it.each(['DM', 'GROUP_DM'] as const)(
        'refuses a %s as the default',
        async (type) => {
          mockChannelRepo.findById.mockResolvedValue({
            ...baseChannel,
            type,
            member_ids: ['user-1', 'user-2'],
          });

          await expect(
            service.updateChannel('chan-1', 'ch-1', { is_default: true }),
          ).rejects.toThrow(BadRequestException);
          expect(mockChannelRepo.setDefault).not.toHaveBeenCalled();
          expect(mockChannelRepo.update).not.toHaveBeenCalled();
        },
      );
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

    // #988: the push worker's channel cache carries `who_can_see` as an
    // authorization input. A write that changes it must evict the cached
    // entry rather than let up to 30s of pushes decide from the old value.
    it('evicts the push worker channel cache on a successful update', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.update.mockResolvedValue(baseChannel);

      await service.updateChannel('chan-1', 'ch-1', { who_can_see: null });

      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-1');
    });

    it('does not evict the cache when the update is rejected', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGated);

      await expect(
        service.updateChannel('chan-1', 'ch-1', { who_can_see: [] }),
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
      who_can_see: [OFFICERS],
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

      // #2303: a hidden DM stays in the response, flagged, so a jump that
      // resolves a channel id against this list still finds it.
      it('flags only the DMs the caller has hidden, and keeps them in the list', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);
        mockReadReceiptRepo.findHiddenChannelIds.mockResolvedValue(
          new Set(['ch-dm-mine']),
        );

        const result = await service.getChannelList('ch-1', 'user-1');

        expect(result.map((channel) => [channel.id, channel.hidden])).toEqual([
          ['ch-chan-1', false],
          ['ch-dm-mine', true],
          ['ch-priv-mine', false],
        ]);
        expect(mockReadReceiptRepo.findHiddenChannelIds).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
        );
      });

      it('shows every channel rather than failing the list when the hidden lookup fails', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);
        mockReadReceiptRepo.findHiddenChannelIds.mockRejectedValue(
          new Error('function get_hidden_channel_ids does not exist'),
        );

        const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

        const result = await service.getChannelList('ch-1', 'user-1');

        expect(result.map((channel) => [channel.id, channel.hidden])).toEqual([
          ['ch-chan-1', false],
          ['ch-dm-mine', false],
          ['ch-priv-mine', false],
        ]);
        expect(reported).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            level: 'warning',
            site: 'chat-hidden-channels-read',
          }),
        );
        reported.mockRestore();
      });

      it('skips the hidden lookup when the caller has no DM in the list', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([baseChannel]);

        const result = await service.getChannelList('ch-1', 'user-1');

        expect(result.map((channel) => channel.hidden)).toEqual([false]);
        expect(mockReadReceiptRepo.findHiddenChannelIds).not.toHaveBeenCalled();
      });

      it('leaves getChannels (the activity feed’s read) without the hidden lookup', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue(everything);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result.every((channel) => !('hidden' in channel))).toBe(true);
        expect(mockReadReceiptRepo.findHiddenChannelIds).not.toHaveBeenCalled();
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

      it('hides a channel whose who-can-see list leaves the caller out', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([roleGated]);

        const result = await service.getChannels('ch-1', 'user-1');

        expect(result).toEqual([]);
      });

      it('returns it once the caller holds a tier or role on the list', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([roleGated]);
        mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(OFFICERS));

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

      // The read filter needs no roles when no channel has a who-can-see
      // list; the post flag (the Alumni rule) reads them once for the list.
      it('resolves what the caller holds at most once', async () => {
        mockChannelRepo.findByChapter.mockResolvedValue([baseChannel, dmMine]);

        await service.getChannels('ch-1', 'user-1');

        expect(
          mockRbac.getChannelAccessHolder.mock.calls.length,
        ).toBeLessThanOrEqual(1);
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
      it('returns a channel the caller can read, annotated with can_post (#704)', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);

        await expect(
          service.getChannel('ch-chan-1', 'ch-1', 'user-1'),
        ).resolves.toEqual({ ...baseChannel, can_post: true });
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
      expect(mockChannelRepo.createDm).not.toHaveBeenCalled();
    });

    it('should create a new DM if not found', async () => {
      const dmChannel = {
        ...baseChannel,
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findDm.mockResolvedValue(null);
      mockChannelRepo.createDm.mockResolvedValue(dmChannel);

      const result = await service.getOrCreateDm({
        chapter_id: 'ch-1',
        member_ids: ['user-1', 'user-2'],
      });

      expect(mockChannelRepo.createDm).toHaveBeenCalledWith('ch-1', [
        'user-1',
        'user-2',
      ]);
      expect(mockChannelRepo.create).not.toHaveBeenCalled();
      expect(result.type).toBe('DM');
    });

    // #2303: opening a DM you hid is the explicit way back to it.
    it('clears the opener’s own hide when they open an existing DM', async () => {
      const dmChannel = {
        ...baseChannel,
        id: 'ch-dm',
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findDm.mockResolvedValue(dmChannel);

      await service.getOrCreateDm(
        { chapter_id: 'ch-1', member_ids: ['user-1', 'user-2'] },
        'user-1',
      );

      expect(mockReadReceiptRepo.unhideChannel).toHaveBeenCalledTimes(1);
      expect(mockReadReceiptRepo.unhideChannel).toHaveBeenCalledWith(
        'ch-dm',
        'user-1',
      );
    });

    it('still opens the DM when clearing the hide fails', async () => {
      const dmChannel = {
        ...baseChannel,
        id: 'ch-dm',
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findDm.mockResolvedValue(dmChannel);
      mockReadReceiptRepo.unhideChannel.mockRejectedValue(new Error('down'));

      await expect(
        service.getOrCreateDm(
          { chapter_id: 'ch-1', member_ids: ['user-1', 'user-2'] },
          'user-1',
        ),
      ).resolves.toEqual(dmChannel);
    });

    it('clears no hide when nobody opened it (a server-originated DM)', async () => {
      mockChannelRepo.findDm.mockResolvedValue({
        ...baseChannel,
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      });

      await service.getOrCreateDm({
        chapter_id: 'ch-1',
        member_ids: ['user-1', 'user-2'],
      });

      expect(mockReadReceiptRepo.unhideChannel).not.toHaveBeenCalled();
    });

    it('has nothing to unhide on a DM it just created', async () => {
      mockChannelRepo.findDm.mockResolvedValue(null);
      mockChannelRepo.createDm.mockResolvedValue({
        ...baseChannel,
        type: 'DM' as const,
        member_ids: ['user-1', 'user-2'],
      });

      await service.getOrCreateDm(
        { chapter_id: 'ch-1', member_ids: ['user-1', 'user-2'] },
        'user-1',
      );

      expect(mockReadReceiptRepo.unhideChannel).not.toHaveBeenCalled();
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

  // #348 and #2303: spec/behavior/chat/README.md § Direct Messages.
  describe('private channel membership (#1302)', () => {
    const privateChannel: ChatChannel = {
      ...baseChannel,
      type: 'PRIVATE',
      member_ids: ['user-1'],
    };

    describe('addPrivateChannelMember', () => {
      it('adds a chapter member through the atomic RPC and evicts the push cache', async () => {
        mockChannelRepo.findById.mockResolvedValue(privateChannel);
        const updated = { ...privateChannel, member_ids: ['user-1', 'user-2'] };
        mockChannelRepo.addPrivateChannelMember.mockResolvedValue(updated);

        const result = await service.addPrivateChannelMember(
          'ch-chan-1',
          'ch-1',
          'user-2',
        );

        expect(result).toBe(updated);
        expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
          'user-2',
          'ch-1',
        );
        expect(mockChannelRepo.addPrivateChannelMember).toHaveBeenCalledWith(
          'ch-chan-1',
          'ch-1',
          'user-2',
        );
        // `member_ids` decides who is pushed this channel's messages.
        expect(mockChannelCache.invalidate).toHaveBeenCalledWith('ch-chan-1');
      });

      it('refuses someone who is not a member of the chapter, before writing', async () => {
        // `member_ids` has no foreign key, so this check is the only thing
        // keeping a foreign id out of the list.
        mockChannelRepo.findById.mockResolvedValue(privateChannel);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

        await expect(
          service.addPrivateChannelMember('ch-chan-1', 'ch-1', 'outsider'),
        ).rejects.toThrow(BadRequestException);
        expect(mockChannelRepo.addPrivateChannelMember).not.toHaveBeenCalled();
        expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
      });

      it.each(['PUBLIC', 'ROLE_GATED', 'DM', 'GROUP_DM'] as const)(
        'refuses a %s channel',
        async (type) => {
          mockChannelRepo.findById.mockResolvedValue({
            ...privateChannel,
            type,
          });

          await expect(
            service.addPrivateChannelMember('ch-chan-1', 'ch-1', 'user-2'),
          ).rejects.toThrow(BadRequestException);
          expect(
            mockChannelRepo.addPrivateChannelMember,
          ).not.toHaveBeenCalled();
        },
      );

      it('answers 404 for a channel in another chapter', async () => {
        mockChannelRepo.findById.mockResolvedValue(null);

        await expect(
          service.addPrivateChannelMember('ch-chan-1', 'ch-1', 'user-2'),
        ).rejects.toThrow(NotFoundException);
        expect(mockChannelRepo.addPrivateChannelMember).not.toHaveBeenCalled();
      });

      it('answers 404 when the channel is deleted between the check and the write', async () => {
        mockChannelRepo.findById.mockResolvedValue(privateChannel);
        mockChannelRepo.addPrivateChannelMember.mockResolvedValue(null);

        await expect(
          service.addPrivateChannelMember('ch-chan-1', 'ch-1', 'user-2'),
        ).rejects.toThrow(NotFoundException);
        expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
      });

      it('does not require the caller to be in the channel', async () => {
        // Authorized by `channels:manage` at the controller, like PATCH and
        // DELETE on a channel: an officer can add themselves to a private
        // channel they cannot yet read. Nothing here takes a caller id.
        mockChannelRepo.findById.mockResolvedValue({
          ...privateChannel,
          member_ids: ['someone-else'],
        });
        mockChannelRepo.addPrivateChannelMember.mockResolvedValue({
          ...privateChannel,
          member_ids: ['someone-else', 'user-1'],
        });

        await expect(
          service.addPrivateChannelMember('ch-chan-1', 'ch-1', 'user-1'),
        ).resolves.toEqual(
          expect.objectContaining({ member_ids: ['someone-else', 'user-1'] }),
        );
      });
    });

    describe('removePrivateChannelMember', () => {
      it('removes through the atomic RPC and evicts the push cache', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...privateChannel,
          member_ids: ['user-1', 'user-2'],
        });
        mockChannelRepo.removePrivateChannelMember.mockResolvedValue(
          privateChannel,
        );

        const result = await service.removePrivateChannelMember(
          'ch-chan-1',
          'ch-1',
          'user-2',
        );

        expect(result).toBe(privateChannel);
        expect(mockChannelRepo.removePrivateChannelMember).toHaveBeenCalledWith(
          'ch-chan-1',
          'ch-1',
          'user-2',
        );
        expect(mockChannelCache.invalidate).toHaveBeenCalledWith('ch-chan-1');
      });

      it('does not check chapter membership, so a stale id can be cleaned out', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...privateChannel,
          member_ids: ['user-1', 'left-the-chapter'],
        });
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
        mockChannelRepo.removePrivateChannelMember.mockResolvedValue(
          privateChannel,
        );

        await expect(
          service.removePrivateChannelMember(
            'ch-chan-1',
            'ch-1',
            'left-the-chapter',
          ),
        ).resolves.toBe(privateChannel);
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      });

      it('refuses to remove the last member with a 409', async () => {
        // The RPC refuses (no row) and the channel is still there, so the
        // refusal was the last-member guard, not a concurrent delete.
        mockChannelRepo.findById.mockResolvedValue(privateChannel);
        mockChannelRepo.removePrivateChannelMember.mockResolvedValue(null);

        await expect(
          service.removePrivateChannelMember('ch-chan-1', 'ch-1', 'user-1'),
        ).rejects.toThrow(ConflictException);
        expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
      });

      it('answers 404 when the channel is deleted between the check and the write', async () => {
        mockChannelRepo.findById
          .mockResolvedValueOnce(privateChannel)
          .mockResolvedValueOnce(null);
        mockChannelRepo.removePrivateChannelMember.mockResolvedValue(null);

        await expect(
          service.removePrivateChannelMember('ch-chan-1', 'ch-1', 'user-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('refuses a Group DM, whose membership changes only by leaving', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...privateChannel,
          type: 'GROUP_DM',
          member_ids: ['user-1', 'user-2', 'user-3'],
        });

        await expect(
          service.removePrivateChannelMember('ch-chan-1', 'ch-1', 'user-2'),
        ).rejects.toThrow(BadRequestException);
        expect(
          mockChannelRepo.removePrivateChannelMember,
        ).not.toHaveBeenCalled();
      });

      it('answers 404 for a channel in another chapter', async () => {
        mockChannelRepo.findById.mockResolvedValue(null);

        await expect(
          service.removePrivateChannelMember('ch-chan-1', 'ch-1', 'user-1'),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('leaveChannel', () => {
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

      await service.leaveChannel('ch-chan-1', 'ch-1', 'user-1');

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

    it('rejects leaving a PUBLIC channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel); // PUBLIC

      await expect(
        service.leaveChannel('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
    });

    it('rejects a Group DM the caller is not a member of', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...groupDm,
        member_ids: ['user-2', 'user-3'],
      });

      await expect(
        service.leaveChannel('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
    });

    it('rejects a channel in another chapter as not found', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.leaveChannel('ch-chan-x', 'ch-other', 'user-1'),
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
        service.leaveChannel('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
    });

    it('evicts the push worker channel cache on leave', async () => {
      mockChannelRepo.findById.mockResolvedValue(groupDm);
      mockChannelRepo.leaveGroupDm.mockResolvedValue({
        ...groupDm,
        member_ids: ['user-2', 'user-3'],
      });

      await service.leaveChannel('ch-chan-1', 'ch-1', 'user-1');

      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('ch-chan-1');
    });

    // #2303: a 1:1 DM is hidden for the caller, never left.
    describe('on a 1:1 DM', () => {
      const dm: ChatChannel = {
        ...baseChannel,
        id: 'ch-dm',
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };

      it('hides it for the caller only, through the receipt RPC', async () => {
        mockChannelRepo.findById.mockResolvedValue(dm);
        mockReadReceiptRepo.hideDirectMessage.mockResolvedValue({
          id: 'r-1',
          channel_id: 'ch-dm',
          user_id: 'user-1',
          last_read_at: '2026-09-25T20:00:00.000Z',
          hidden_at: '2026-09-25T20:00:00.000Z',
          updated_at: '2026-09-25T20:00:00.000Z',
        });

        await service.leaveChannel('ch-dm', 'ch-1', 'user-1');

        expect(mockReadReceiptRepo.hideDirectMessage).toHaveBeenCalledTimes(1);
        expect(mockReadReceiptRepo.hideDirectMessage).toHaveBeenCalledWith(
          'ch-dm',
          'ch-1',
          'user-1',
        );
      });

      it('clears the chat notifications the hide marked read (#3788)', async () => {
        mockChannelRepo.findById.mockResolvedValue(dm);
        mockReadReceiptRepo.hideDirectMessage.mockResolvedValue({
          id: 'r-1',
          channel_id: 'ch-dm',
          user_id: 'user-1',
          last_read_at: '2026-09-25T20:00:00.000Z',
          hidden_at: '2026-09-25T20:00:00.000Z',
          updated_at: '2026-09-25T20:00:00.000Z',
        });

        await service.leaveChannel('ch-dm', 'ch-1', 'user-1');

        expect(
          mockNotificationService.markChatChannelNotificationsRead,
        ).toHaveBeenCalledWith(
          'user-1',
          'ch-1',
          'ch-dm',
          '2026-09-25T20:00:00.000Z',
        );
      });

      it('changes nothing the other member sees, and deletes nothing', async () => {
        mockChannelRepo.findById.mockResolvedValue(dm);
        mockReadReceiptRepo.hideDirectMessage.mockResolvedValue({
          id: 'r-1',
          channel_id: 'ch-dm',
          user_id: 'user-1',
          last_read_at: '2026-09-25T20:00:00.000Z',
          hidden_at: '2026-09-25T20:00:00.000Z',
          updated_at: '2026-09-25T20:00:00.000Z',
        });

        await service.leaveChannel('ch-dm', 'ch-1', 'user-1');

        // The channel row (member_ids, archived_at) is shared by both
        // members, so any write to it would reach the other one.
        expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
        expect(mockChannelRepo.update).not.toHaveBeenCalled();
        expect(mockChannelRepo.delete).not.toHaveBeenCalled();
        expect(mockMessageRepo.update).not.toHaveBeenCalled();
        expect(mockChannelCache.invalidate).not.toHaveBeenCalled();
      });

      it('rejects a DM the caller is not in, before hiding anything', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...dm,
          member_ids: ['user-2', 'user-3'],
        });

        await expect(
          service.leaveChannel('ch-dm', 'ch-1', 'user-1'),
        ).rejects.toThrow(ForbiddenException);
        expect(mockReadReceiptRepo.hideDirectMessage).not.toHaveBeenCalled();
      });

      it('surfaces a not-found if the RPC matches no row', async () => {
        mockChannelRepo.findById.mockResolvedValue(dm);
        mockReadReceiptRepo.hideDirectMessage.mockResolvedValue(null);

        await expect(
          service.leaveChannel('ch-dm', 'ch-1', 'user-1'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    it('rejects a PRIVATE channel the caller is in', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'PRIVATE',
        member_ids: ['user-1'],
      });

      await expect(
        service.leaveChannel('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockChannelRepo.leaveGroupDm).not.toHaveBeenCalled();
      expect(mockReadReceiptRepo.hideDirectMessage).not.toHaveBeenCalled();
    });
  });

  describe('setDisplayLock (Always formal, #3787)', () => {
    const created = { ...baseChannel, created_by: 'u-creator' };

    it('lets the creator lock a channel without channels:manage', async () => {
      mockChannelRepo.findById.mockResolvedValue(created);
      mockChannelRepo.update.mockResolvedValue({
        ...created,
        display_locked: true,
      });

      const result = await service.setDisplayLock(
        'ch-chan-1',
        'ch-1',
        'u-creator',
        false,
        true,
      );

      expect(result.display_locked).toBe(true);
      expect(mockChannelRepo.update).toHaveBeenCalledWith('ch-chan-1', 'ch-1', {
        display_locked: true,
      });
    });

    it('lets a channels:manage holder lock a channel they did not create', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.update.mockResolvedValue({
        ...baseChannel,
        display_locked: true,
      });

      await service.setDisplayLock(
        'ch-chan-1',
        'ch-1',
        'u-officer',
        true,
        true,
      );

      expect(mockChannelRepo.update).toHaveBeenCalled();
    });

    it('refuses any other member', async () => {
      mockChannelRepo.findById.mockResolvedValue(created);

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-member', false, true),
      ).rejects.toThrow(ForbiddenException);
      expect(mockChannelRepo.update).not.toHaveBeenCalled();
    });

    it('refuses everyone but channels:manage on a channel with no recorded creator', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-member', false, false),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each(['DM', 'GROUP_DM'] as const)('refuses a %s', async (type) => {
      mockChannelRepo.findById.mockResolvedValue({ ...baseChannel, type });

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-officer', true, true),
      ).rejects.toThrow(BadRequestException);
      expect(mockChannelRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a creator who can no longer read their channel, and returns no row', async () => {
      // Removed from their own PRIVATE channel by an officer.
      mockChannelRepo.findById.mockResolvedValue({
        ...created,
        type: 'PRIVATE',
        member_ids: ['u-officer'],
      });

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-creator', false, true),
      ).rejects.toThrow(ForbiddenException);
      expect(mockChannelRepo.update).not.toHaveBeenCalled();
    });

    it('lets a PRIVATE channel creator who is still a member set it', async () => {
      const own = {
        ...created,
        type: 'PRIVATE' as const,
        member_ids: ['u-creator'],
      };
      mockChannelRepo.findById.mockResolvedValue(own);
      mockChannelRepo.update.mockResolvedValue({
        ...own,
        display_locked: true,
      });

      await service.setDisplayLock(
        'ch-chan-1',
        'ch-1',
        'u-creator',
        false,
        true,
      );

      expect(mockChannelRepo.update).toHaveBeenCalled();
    });

    it("answers a member's DM probe with 403, not the DM 400", async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'GROUP_DM',
        member_ids: ['u-member', 'u-2', 'u-3'],
      });

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-member', false, true),
      ).rejects.toThrow(ForbiddenException);
    });

    it('writes nothing when the lock is already in that state', async () => {
      const locked = { ...created, display_locked: true };
      mockChannelRepo.findById.mockResolvedValue(locked);

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-creator', false, true),
      ).resolves.toEqual(locked);
      expect(mockChannelRepo.update).not.toHaveBeenCalled();
    });

    it('answers 404 for a channel outside the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.setDisplayLock('ch-chan-1', 'ch-1', 'u-officer', true, true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteChannel', () => {
    it('should delete existing channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockChannelRepo.delete.mockResolvedValue();

      await service.deleteChannel('ch-chan-1', 'ch-1');
      expect(mockChannelRepo.delete).toHaveBeenCalledWith('ch-chan-1', 'ch-1');
    });

    it('refuses deleting the audit log (#3909)', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        name: 'chapter-audit',
        is_read_only: true,
        is_audit_log: true,
      });

      await expect(service.deleteChannel('ch-chan-1', 'ch-1')).rejects.toThrow(
        "The audit log channel can't be deleted",
      );
      expect(mockChannelRepo.delete).not.toHaveBeenCalled();
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

  // ── Messages ─────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return messages without pagination options', async () => {
      const messages = [baseMessage];
      mockMessageRepo.findByChannel.mockResolvedValue(messages);

      const result = await service.getMessages('ch-chan-1', 'ch-1', 'user-1');

      expect(mockMessageRepo.findByChannel).toHaveBeenCalledWith('ch-chan-1', {
        limit: 50,
      });
      // Every row carries `sender_blocked` (#2257) — see the masking cases
      // below for why the flag is present even when nothing is blocked.
      expect(result).toEqual([{ ...baseMessage, sender_blocked: false }]);
    });

    it('should pass pagination options to repository', async () => {
      const messages = [baseMessage];
      mockMessageRepo.findByChannel.mockResolvedValue(messages);

      const options = { limit: 20, before: '2026-04-01T12:00:00.000Z' };
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
      expect(result).toEqual([{ ...baseMessage, sender_blocked: false }]);
    });

    it('rejects a calendar-invalid before cursor instead of forwarding it', async () => {
      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'user-1', {
          before: '2026-02-30T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockMessageRepo.findByChannel).not.toHaveBeenCalled();
    });

    it('passes a since cursor through to the repository', async () => {
      mockMessageRepo.findByChannel.mockResolvedValue([]);

      await service.getMessages('ch-chan-1', 'ch-1', 'user-1', {
        since: 'msg-cursor',
        limit: 100,
      });

      expect(mockMessageRepo.findByChannel).toHaveBeenCalledWith('ch-chan-1', {
        since: 'msg-cursor',
        limit: 100,
      });
    });

    it('answers a since cursor that names no message in the channel with a coded 404 (#2807)', async () => {
      // Coded because "Channel not found" is a 404 on this route too, and the
      // backfill drops its cursor for this one only.
      mockMessageRepo.findByChannel.mockRejectedValue(
        new ChatMessageCursorNotFoundError('ch-chan-1', 'msg-purged'),
      );

      const refusal = await service
        .getMessages('ch-chan-1', 'ch-1', 'user-1', { since: 'msg-purged' })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(NotFoundException);
      expect((refusal as NotFoundException).getResponse()).toEqual(
        expect.objectContaining({ code: CHAT_SINCE_NOT_FOUND_CODE }),
      );
    });

    it('rethrows any other repository failure as it is', async () => {
      const failure = new Error('connection reset');
      mockMessageRepo.findByChannel.mockRejectedValue(failure);

      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'user-1', { since: 'm1' }),
      ).rejects.toBe(failure);
    });

    it('clamps an oversized limit before the repository', async () => {
      mockMessageRepo.findByChannel.mockResolvedValue([]);

      await service.getMessages('ch-chan-1', 'ch-1', 'user-1', {
        limit: 500,
      });

      expect(mockMessageRepo.findByChannel).toHaveBeenCalledWith('ch-chan-1', {
        limit: 200,
      });
    });

    // ── Block masking (#2257) ────────────────────────────────────────
    //
    // `spec/behavior/chat/README.md` § The masking contract. The server masks
    // what it serves; the client additionally applies its own list to rows that
    // arrive over the Realtime echo, which carries no viewer and so cannot be
    // masked here.

    it('masks messages from a member the caller has blocked', async () => {
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockMessageRepo.findByChannel.mockResolvedValue([
        { ...baseMessage, id: 'msg-mine' },
        {
          ...baseMessage,
          id: 'msg-theirs',
          sender_id: 'user-blocked',
          content: 'go away',
        },
      ]);

      const result = await service.getMessages('ch-chan-1', 'ch-1', 'user-1');

      expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'msg-mine',
          content: 'Hello world',
          sender_blocked: false,
        }),
        expect.objectContaining({
          id: 'msg-theirs',
          content: BLOCKED_MESSAGE_CONTENT,
          sender_blocked: true,
        }),
      ]);
    });

    it('resolves the block list for the caller, in the caller chapter', async () => {
      // Per-viewer, per-chapter: the same row reads differently for two members
      // of the same channel, which is why this cannot live in the repository or
      // a view.
      mockMessageRepo.findByChannel.mockResolvedValue([baseMessage]);

      await service.getMessages('ch-chan-1', 'ch-1', 'user-1');

      expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
    });

    it('fails the read when the block list cannot be read', async () => {
      // "A block list that cannot be read is not an empty block list." Serving
      // the thread unmasked here would fail open on a safety feature for as long
      // as the table was unreachable.
      mockChatBlocks.listBlockedUserIds.mockRejectedValue(new Error('pg down'));
      mockMessageRepo.findByChannel.mockResolvedValue([baseMessage]);

      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('pg down');
    });

    it('masks the pinned list too, which is channel content and not an officer surface', async () => {
      // A pin is precisely the message that stays in front of the blocker
      // indefinitely, so leaving this read unmasked would be a durable hole.
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockMessageRepo.findPinnedByChannel.mockResolvedValue([
        {
          ...baseMessage,
          id: 'msg-pinned',
          sender_id: 'user-blocked',
          content: 'go away',
        },
      ]);

      const result = await service.getPinnedMessages(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );

      expect(result).toEqual([
        expect.objectContaining({
          id: 'msg-pinned',
          content: BLOCKED_MESSAGE_CONTENT,
          sender_blocked: true,
        }),
      ]);
    });

    it('reads the block list once for the whole pinned list', async () => {
      // A channel can hold 50 pins; a per-pin read would be 50 queries per
      // panel open, and would still mask correctly (#2310).
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockMessageRepo.findPinnedByChannel.mockResolvedValue([
        { ...baseMessage, id: 'msg-pinned-1', sender_id: 'user-blocked' },
        { ...baseMessage, id: 'msg-pinned-2' },
      ]);

      const result = await service.getPinnedMessages(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );

      expect(result.map((message) => message.sender_blocked)).toEqual([
        true,
        false,
      ]);
      expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledTimes(1);
    });

    it('fails the pinned read when the block list cannot be read', async () => {
      // The same fail-closed rule as `getMessages`, pinned separately because
      // it is a separate call site: a `.catch(() => [])` added to one and not
      // the other leaves a durable hole in exactly the list that stays in front
      // of the blocker indefinitely.
      mockChatBlocks.listBlockedUserIds.mockRejectedValue(new Error('pg down'));
      mockMessageRepo.findPinnedByChannel.mockResolvedValue([baseMessage]);

      await expect(
        service.getPinnedMessages('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('pg down');
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

    it('should allow reads of a channel whose who-can-see list names the caller', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'ROLE_GATED',
        who_can_see: [OFFICERS],
      });
      mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(OFFICERS));
      mockMessageRepo.findByChannel.mockResolvedValue([baseMessage]);

      const result = await service.getMessages('ch-chan-1', 'ch-1', 'user-1');
      expect(result).toEqual([{ ...baseMessage, sender_blocked: false }]);
    });

    it('should reject reads of a channel whose who-can-see list leaves the caller out', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        type: 'ROLE_GATED',
        who_can_see: [OFFICERS],
      });
      mockRbac.getChannelAccessHolder.mockResolvedValue(
        holderOf('role:00000000-0000-4000-8000-0000000000aa'),
      );

      await expect(
        service.getMessages('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sendMessage', () => {
    describe('U+FFFC, the "OBJ" box (#4346)', () => {
      it('saves the text with each one turned into a space', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'take a look\uFFFC',
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ content: 'take a look ' }),
        );
      });

      it('refuses a message that was only the placeholder, as an empty one', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: '\uFFFC ',
          }),
        ).rejects.toThrow('A message needs content or at least one attachment');
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });
    });

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
      asAnnouncer();
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
      const PHOTO_GEOMETRY = {
        width: 1200,
        height: 800,
        thumbhash: '1QcSHQRnh493V4dIh4eXh1h4kJUI',
      };
      const PHOTO = {
        storage_path:
          'chapters/ch-1/chat/ch-chan-1/aaaaaaaa-0000-4000-8000-000000000001/photo.jpg',
        filename: 'photo.jpg',
        content_type: 'image/jpeg',
        ...PHOTO_GEOMETRY,
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

      it('accepts a filename with two dots in a row, as the mint does (#3059)', async () => {
        // `safeObjectFilename` keeps dots and the mint's segment check passes
        // `Notes..final.png`, so the bytes are already uploaded by now.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
        const storage_path =
          'chapters/ch-1/chat/ch-chan-1/aaaaaaaa-0000-4000-8000-000000000001/Notes..final.png';

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: '',
          attachments: [
            {
              ...ATTACHMENT,
              storage_path,
              filename: 'Notes..final.png',
              content_type: 'image/png',
            },
          ],
        });

        expect(mockAttachmentRepo.createMany).toHaveBeenCalledWith([
          expect.objectContaining({ storage_path }),
        ]);
      });

      it.each([
        'chapters/ch-1/chat/ch-chan-1/../other-channel/m/secret.pdf',
        'chapters/ch-1/chat/ch-chan-1/%2e%2e/other-channel/m/secret.pdf',
        'chapters/ch-1/chat/ch-chan-1/m/./secret.pdf',
      ])(
        'refuses a dot segment under the channel prefix (%s)',
        async (storage_path) => {
          mockChannelRepo.findById.mockResolvedValue(baseChannel);

          await expect(
            service.sendMessage({
              chapter_id: 'ch-1',
              channel_id: 'ch-chan-1',
              sender_id: 'user-1',
              content: 'look',
              attachments: [{ ...ATTACHMENT, storage_path }],
            }),
          ).rejects.toThrow('Invalid attachment path');
          expect(mockAttachmentRepo.createMany).not.toHaveBeenCalled();
        },
      );

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

      it("stamps each photo's geometry beside the count (#3879)", async () => {
        // A Realtime echo is the bare row, so the row has to say how big each
        // photo is for a reader to reserve its box before the attachments read
        // returns. One entry per photo, sized or not; a file gets none.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
        const photoPath = (name: string) =>
          `chapters/ch-1/chat/ch-chan-1/aaaaaaaa-0000-4000-8000-000000000001/${name}`;

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: '',
          attachments: [
            ATTACHMENT,
            {
              storage_path: photoPath('sized.jpg'),
              filename: 'sized.jpg',
              content_type: 'image/jpeg',
              width: 1200,
              height: 800,
              thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
            },
            {
              storage_path: photoPath('unsized.png'),
              filename: 'unsized.png',
              content_type: 'image/png',
              // A lone edge is dropped by validation, so this one is unsized.
              width: 640,
            },
          ],
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              attachment_count: 3,
              attachment_photos: [
                {
                  width: 1200,
                  height: 800,
                  thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
                },
                { width: null, height: null, thumbhash: null },
              ],
            }),
          }),
        );
      });

      it("drops a client's own count and geometry, which only the server stamps", async () => {
        // Sent verbatim, a forged count drew a placeholder per claimed file on
        // every reader (#3879 review).
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'hi',
          metadata: {
            attachment_count: 10_000_000,
            attachment_photos: [],
            kept: true,
          },
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ metadata: { kept: true } }),
        );
      });

      it('keeps no ThumbHash a decoder cannot read in full', async () => {
        // `AAAA` passes the base64 pattern but is 3 bytes; expo-image's iOS
        // decoder reads 5 header bytes unchecked and crashes.
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: '',
          attachments: [{ ...PHOTO, thumbhash: 'AAAA' }],
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              attachment_photos: [{ ...PHOTO_GEOMETRY, thumbhash: null }],
            }),
          }),
        );
        expect(mockAttachmentRepo.createMany).toHaveBeenCalledWith([
          expect.objectContaining({ thumbhash: null }),
        ]);
      });

      it('stamps no geometry on a message with no attachments', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);

        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'plain',
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.not.objectContaining({
              attachment_photos: expect.anything(),
            }),
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
          metadata: { attachment_count: 1, attachment_photos: [] },
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
        // The geometry goes with the count: it describes files that are not there.
        const cleared = mockMessageRepo.update.mock.calls.at(-1)?.[1] as {
          metadata: Record<string, unknown>;
        };
        expect(cleared.metadata).not.toHaveProperty('attachment_photos');
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
          attachments: [ATTACHMENT, PHOTO],
        });

        expect(result.deduplicated).toBe(true);
        expect(mockAttachmentRepo.createMany).toHaveBeenCalledWith([
          expect.objectContaining({ message_id: baseMessage.id }),
          expect.objectContaining({ message_id: baseMessage.id }),
        ]);
        // The failed first attempt cleared the count and the geometry; the
        // retry puts both back (#3879).
        expect(mockMessageRepo.update).toHaveBeenCalledWith(
          baseMessage.id,
          expect.objectContaining({
            metadata: expect.objectContaining({
              attachment_count: 2,
              attachment_photos: [PHOTO_GEOMETRY],
            }),
          }),
        );
      });
    });

    it('rejects client posts of server-originated kinds (points, system_audit, hours, rush)', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      for (const kind of ['points', 'system_audit', 'hours', 'rush'] as const) {
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

    // The announcement card draws with the chapter's official chrome, so only
    // the announcements channel's posters may produce one (#3414).
    describe('an announcement card is only posted in the announcements channel (#3414)', () => {
      const send = (
        extra: Partial<Parameters<ChatService['sendMessage']>[0]> = {},
      ) =>
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Chapter meeting is cancelled',
          kind: 'announcement',
          payload: { body: 'Chapter meeting is cancelled' },
          ...extra,
        });

      const PLACEMENT =
        'Announcements can only be posted in the announcements channel';

      beforeEach(() => {
        mockMessageRepo.create.mockResolvedValue(baseMessage);
      });

      it('refuses one a member sends in #general', async () => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);

        await expect(send()).rejects.toThrow(PLACEMENT);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('refuses one sent in a DM', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...baseChannel,
          name: 'dm-user-1-user-2',
          type: 'DM' as const,
          member_ids: ['user-1', 'user-2'],
        });

        await expect(send()).rejects.toThrow(PLACEMENT);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      // Named like the real channel, but anyone can post in it, so it is not
      // the channel an announcement push or card is decided by.
      it('refuses one in a channel named announcements that anyone can post in', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...baseChannel,
          name: 'announcements',
        });

        await expect(send()).rejects.toThrow(PLACEMENT);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('refuses a member who is not on the announcements channel\u2019s who-can-post list', async () => {
        mockChannelRepo.findById.mockResolvedValue(announcementsChannel);

        await expect(send()).rejects.toThrow(
          'You do not have access to this channel',
        );
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('refuses one as a thread reply under an announcement', async () => {
        asAnnouncer();
        mockMessageRepo.findById.mockResolvedValue({
          ...baseMessage,
          channel_id: 'ch-chan-1',
          kind: 'announcement',
        });

        await expect(send({ thread_root_id: baseMessage.id })).rejects.toThrow(
          PLACEMENT,
        );
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('posts one from a member on the announcements channel\u2019s who-can-post list', async () => {
        asAnnouncer();

        await send();

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'announcement' }),
        );
      });
    });

    // `payload.closed_at` / `closed_by` are written only by `PollService.close`
    // (#3794), which checks the caller is the poll's creator.
    describe('a poll card cannot arrive closed (#3794)', () => {
      beforeEach(() => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
      });

      const card = {
        question: 'Formal venue?',
        options: [
          { id: 'a', label: 'The Lodge' },
          { id: 'b', label: 'Riverside' },
        ],
        closes_at: '2999-01-01T00:00:00.000Z',
      };

      it('drops closed_at and closed_by from a poll card a client posts, keeping the rest', async () => {
        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Formal venue?',
          kind: 'poll',
          payload: {
            ...card,
            closed_at: '2026-01-01T00:00:00.000Z',
            closed_by: 'user-2',
          },
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'poll', payload: card }),
        );
      });

      it('leaves another kind payload exactly as sent', async () => {
        asAnnouncer();
        const payload = { body: 'Hi', closed_at: 'kept' };
        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Hi',
          kind: 'announcement',
          payload,
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ payload }),
        );
      });
    });

    // `claim_signup_slots` trusts the stored slots' ids and limits on every
    // claim, so the card is checked and rebuilt on send (#3926).
    describe('a sign-up card is checked on send (#3926)', () => {
      beforeEach(() => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
      });

      const sendSignup = (payload: Record<string, unknown>) =>
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Sober drivers',
          kind: 'signup',
          payload,
        });

      it('stores the card rebuilt from its known fields', async () => {
        await sendSignup({
          title: ' Sober drivers ',
          slots: [{ id: 'fri', label: 'Friday', capacity: 2 }],
          closed_at: '2026-01-01T00:00:00.000Z',
        });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'signup',
            payload: {
              title: 'Sober drivers',
              slots: [{ id: 'fri', label: 'Friday', capacity: 2 }],
            },
          }),
        );
      });

      it('refuses a card it cannot read, writing nothing', async () => {
        await expect(
          sendSignup({
            title: 'Sober drivers',
            slots: [{ id: 'fri', label: 'Friday', capacity: 0 }],
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('needs no module: a sign-up posts with every module off', async () => {
        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Sober drivers',
          kind: 'signup',
          payload: { title: 'Sober drivers', slots: [{ id: 'a', label: 'A' }] },
          enabled_modules: { polls: false },
        });

        expect(mockMessageRepo.create).toHaveBeenCalled();
      });
    });

    describe('module gate on card kinds (#2993)', () => {
      const sendPoll = (enabled_modules?: Record<string, boolean> | null) =>
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Formal venue?',
          kind: 'poll',
          payload: { question: 'Formal venue?', options: [] },
          enabled_modules,
        });

      beforeEach(() => {
        mockChannelRepo.findById.mockResolvedValue(baseChannel);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
      });

      it('refuses a poll while Polls is off, with the guard refusal, and writes nothing', async () => {
        const refusal = await sendPoll({ polls: false }).catch(
          (error: unknown) => error,
        );

        expect(refusal).toBeInstanceOf(ForbiddenException);
        expect((refusal as ForbiddenException).getResponse()).toEqual({
          code: 'chapter.module.disabled',
          message: moduleDisabledMessage('polls'),
        });
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('posts a poll while Polls is on', async () => {
        await sendPoll({ polls: true });

        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'poll' }),
        );
      });

      it('posts a poll when the chapter has no Polls key (enabled unless explicitly false)', async () => {
        await sendPoll({ events: false });
        await sendPoll(null);

        expect(mockMessageRepo.create).toHaveBeenCalledTimes(2);
      });

      it('answers a replay of a poll that committed before Polls went off as a duplicate', async () => {
        // The outbox replays a send whose response was lost. Refusing it would
        // have the client mark a poll that exists on the server as failed.
        const committed = { ...baseMessage, kind: 'poll' as const };
        mockMessageRepo.findByClientMessageId.mockResolvedValue(committed);

        const result = await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Formal venue?',
          kind: 'poll',
          client_message_id: '11111111-1111-1111-1111-111111111111',
          enabled_modules: { polls: false },
        });

        expect(result).toEqual({ message: committed, deduplicated: true });
        expect(mockMessageRepo.findByClientMessageId).toHaveBeenCalledWith(
          'ch-chan-1',
          'user-1',
          '11111111-1111-1111-1111-111111111111',
        );
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('still refuses a new poll whose client id matches nothing', async () => {
        mockMessageRepo.findByClientMessageId.mockResolvedValue(null);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Formal venue?',
            kind: 'poll',
            client_message_id: '22222222-2222-2222-2222-222222222222',
            enabled_modules: { polls: false },
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('refuses a dues card while Dues is off', async () => {
        // The dues exemption keeps paying reachable; a card pays nothing.
        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Dues reminder',
            kind: 'dues',
            enabled_modules: { dues: false },
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });

      it('leaves a text message alone while Polls is off', async () => {
        await service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'hello',
          enabled_modules: { polls: false },
        });

        expect(mockMessageRepo.create).toHaveBeenCalled();
      });
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

    it('answers a retry of a since-deleted card with its tombstone, repairing nothing (#1575)', async () => {
      const clientId = '44444444-4444-4444-4444-444444444444';
      mockMessageRepo.create.mockRejectedValue(
        new ChatMessageDuplicateError('ch-chan-1', 'user-1', clientId),
      );
      mockMessageRepo.findByClientMessageId.mockResolvedValue({
        ...baseMessage,
        kind: 'event',
        content: '[message deleted]',
        is_deleted: true,
        // What a delete before #1575 left in the row.
        payload: { name: 'Standards Board — Doe hearing' },
      });

      const result = await service.sendMessage({
        chapter_id: 'ch-1',
        channel_id: 'ch-chan-1',
        sender_id: 'user-1',
        content: 'Hello',
        client_message_id: clientId,
      });

      expect(result.deduplicated).toBe(true);
      expect(result.message.payload).toBeNull();
      expect(result.message.is_deleted).toBe(true);
      expect(mockAttachmentRepo.createMany).not.toHaveBeenCalled();
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
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

    it('does NOT insert when authz denies the send', async () => {
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

    // #3909: `#chapter-audit` is system-write only. The audit mirror inserts
    // its rows through the message repository directly (covered in
    // chat-bridge-worker.service.spec.ts), so this path is refused for every
    // member, the President included.
    describe('in the audit log channel', () => {
      const auditLog: ChatChannel = {
        ...baseChannel,
        name: 'chapter-audit',
        is_read_only: true,
        who_can_post: [OFFICERS],
        is_audit_log: true,
      };

      it.each([
        ['the wildcard', WILDCARD],
        ['a tier on its who-can-post list', holderOf(OFFICERS)],
      ])(
        'refuses a top-level message from a member holding %s',
        async (_label, holder) => {
          mockChannelRepo.findById.mockResolvedValue(auditLog);
          mockRbac.getChannelAccessHolder.mockResolvedValue(holder);

          await expect(
            service.sendMessage({
              chapter_id: 'ch-1',
              channel_id: 'ch-chan-1',
              sender_id: 'user-1',
              content: 'Posting in the audit log',
            }),
          ).rejects.toThrow(ForbiddenException);
          expect(mockMessageRepo.create).not.toHaveBeenCalled();
        },
      );

      it('refuses it even with no who-can-post list on the row', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...auditLog,
          is_read_only: false,
          who_can_post: null,
        });
        mockRbac.getChannelAccessHolder.mockResolvedValue(WILDCARD);

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Posting in the audit log',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });
    });

    // #3722: a quote reply is a post. Whoever may post in a channel with a
    // who-can-post list may quote there; whoever may not is refused at the
    // post gate, before the replied-to message is looked up.
    describe('quote replies in a channel with a who-can-post list', () => {
      const listed: ChatChannel = {
        ...baseChannel,
        name: 'actives',
        is_read_only: true,
        who_can_post: [OFFICERS],
      };

      it('accepts a quote reply from a sender on the list', async () => {
        mockChannelRepo.findById.mockResolvedValue(listed);
        mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(OFFICERS));
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
          content: 'Agreed',
          reply_to_id: 'msg-same',
        });

        expect(result).toEqual({ message: baseMessage, deduplicated: false });
        expect(mockMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ reply_to_id: 'msg-same' }),
        );
      });

      it('refuses a quote reply from a reader not on the list', async () => {
        mockChannelRepo.findById.mockResolvedValue(listed);
        mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf());

        await expect(
          service.sendMessage({
            chapter_id: 'ch-1',
            channel_id: 'ch-chan-1',
            sender_id: 'user-1',
            content: 'Agreed',
            reply_to_id: 'msg-same',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(mockMessageRepo.findById).not.toHaveBeenCalled();
        expect(mockMessageRepo.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('editMessage', () => {
    it('saves an edit with U+FFFC turned into a space, and refuses one left blank (#4346)', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.update.mockResolvedValue(baseMessage);

      await service.editMessage('msg-1', 'ch-1', 'user-1', 'fixed\uFFFCit');
      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({ content: 'fixed it' }),
      );

      mockMessageRepo.update.mockClear();
      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-1', '\uFFFC\n'),
      ).rejects.toThrow('An edited message needs some text');
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

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

    it('rewrites the in-app notifications that quote the edited message, for current readers only (#4418)', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockRbac.getChapterMemberAccess.mockResolvedValue([
        {
          user_id: 'user-2',
          channel_access: EMPTY_ACCESS_HOLDER,
          top_role_order: 0,
          top_role: null,
        },
      ]);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        content: '  Updated  ',
        edited_at: '2026-01-01T13:00:00.000Z',
      });

      await service.editMessage('msg-1', 'ch-1', 'user-1', '  Updated  ');

      expect(
        mockNotificationService.rewriteChatMessagePreview,
      ).toHaveBeenCalledWith('ch-1', 'msg-1', 'Updated', ['user-2']);
    });

    it('leaves the notifications when the readers cannot be resolved', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        content: 'Updated',
      });
      mockRbac.getChapterMemberAccess.mockRejectedValue(new Error('db down'));

      const result = await service.editMessage(
        'msg-1',
        'ch-1',
        'user-1',
        'Updated',
      );

      expect(result.content).toBe('Updated');
      expect(
        mockNotificationService.rewriteChatMessagePreview,
      ).not.toHaveBeenCalled();
    });

    it('rewrites no notification when the edit is refused', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-2', 'Hacked'),
      ).rejects.toThrow(ForbiddenException);
      expect(
        mockNotificationService.rewriteChatMessagePreview,
      ).not.toHaveBeenCalled();
    });

    it("should reject editing another user's message", async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-2', 'Hacked'),
      ).rejects.toThrow(ForbiddenException);
    });

    // #2878: a member who linked their Discord account is the sender of their
    // imported messages. They may delete them, never rewrite them: an archive
    // records what was said then. The clients hide Edit; this is the rule.
    it('refuses to edit an imported message, even for its linked sender', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        kind: 'imported',
        author_name: 'jkslayer',
        author_external_id: '3000000000000000001',
      });

      await expect(
        service.editMessage('msg-1', 'ch-1', 'user-1', 'Rewritten'),
      ).rejects.toThrow('Imported messages cannot be edited');
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('lets the linked sender delete their imported message, keeping it purgeable with its import', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        kind: 'imported',
        author_name: 'jkslayer',
        metadata: { discord_import_id: 'imp-1', attachment_count: 2 },
      });

      mockMessageRepo.update.mockResolvedValue({
        ...baseMessage,
        kind: 'imported',
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
      // The import purge selects on `metadata->>discord_import_id`; wiping it
      // would strand the tombstone when the import is deleted.
      expect(mockMessageRepo.update).toHaveBeenCalledWith('msg-1', {
        content: '[message deleted]',
        is_deleted: true,
        metadata: { discord_import_id: 'imp-1' },
        // No `author_username` on this fixture's payload, so only the source.
        payload: { source: 'discord' },
        flag: null,
        flagged_by: null,
        flagged_at: null,
      });
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
      mockRbac.getChannelAccessHolder.mockResolvedValue(ALUMNUS);

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

    it.each(['event', 'poll', 'task', 'points', 'hours', 'rush'] as const)(
      "clears a %s card's payload, so a delete removes the card and not only its words (#1575)",
      async (kind) => {
        mockMessageRepo.findById.mockResolvedValue({
          ...baseMessage,
          kind,
          payload: { name: 'Standards Board — Doe hearing' },
          metadata: { attachment_count: 1 },
        });
        // A repository that hands back what it stored. Cleared on the write,
        // so the answer and the Realtime UPDATE echo carry no payload either.
        mockMessageRepo.update.mockImplementation(
          async (_id: string, patch: Record<string, unknown>) => ({
            ...baseMessage,
            kind,
            ...patch,
          }),
        );

        const result = await service.deleteMessage(
          'msg-1',
          'ch-1',
          'user-1',
          false,
        );

        expect(mockMessageRepo.update).toHaveBeenCalledWith(
          'msg-1',
          expect.objectContaining({ payload: null, metadata: {} }),
        );
        expect(result.payload).toBeNull();
        expect(JSON.stringify(result)).not.toContain('Doe hearing');
      },
    );

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

    // #514: the spec says "Attachments for deleted messages are removed from
    // Storage". Soft-delete alone left the objects behind, still billable and
    // still reachable by any signed URL issued before the delete.
    describe('attachment purge (#514)', () => {
      const attachment = {
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
        thumbhash: null,
        preview_storage_path: null,
        external_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
      };
      const uploaded = attachment;

      beforeEach(() => {
        mockMessageRepo.findById.mockResolvedValue(baseMessage);
        mockMessageRepo.update.mockResolvedValue({
          ...baseMessage,
          is_deleted: true,
        });
      });

      it('deletes the message objects from Storage', async () => {
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          uploaded.storage_path,
        ]);
      });

      it('keeps an object another message still references', async () => {
        // The Discord importer maps every reference to a deduplicated export
        // file onto one object, and the table's unique key is per message — so
        // purging blind would delete the surviving message's bytes.
        const shared = {
          ...attachment,
          id: 'att-shared',
          bucket: 'chat-archive',
          storage_path: 'chapters/ch-1/chat-archive/ch-chan-1/shared.png',
        };
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded, shared]);
        mockAttachmentRepo.findSharedObjects.mockResolvedValue([
          { bucket: shared.bucket, storage_path: shared.storage_path },
        ]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockAttachmentRepo.findSharedObjects).toHaveBeenCalledWith(
          [
            { bucket: 'chat', storage_path: uploaded.storage_path },
            { bucket: 'chat-archive', storage_path: shared.storage_path },
          ],
          'msg-1',
        );
        // Only the unshared one goes, and the shared bucket is never called.
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledTimes(1);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          uploaded.storage_path,
        ]);
      });

      it('groups the delete per bucket', async () => {
        const archived = {
          ...attachment,
          id: 'att-2',
          bucket: 'chat-archive',
          storage_path: 'chapters/ch-1/chat-archive/ch-chan-1/old.png',
        };
        mockAttachmentRepo.findByMessage.mockResolvedValue([
          uploaded,
          archived,
        ]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          uploaded.storage_path,
        ]);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
        );
      });

      it('still soft-deletes when Storage fails', async () => {
        // The row is the source of truth; an outage must not roll back a
        // delete the member asked for, or 500 them.
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockStorageProvider.deleteFiles.mockRejectedValue(
          new Error('storage down'),
        );

        const result = await service.deleteMessage(
          'msg-1',
          'ch-1',
          'user-1',
          false,
        );

        expect(result.is_deleted).toBe(true);
        expect(mockMessageRepo.update).toHaveBeenCalled();
      });

      it('keeps every object when the shared-object check fails', async () => {
        // Fail closed: an unanswerable "is this shared?" must not read as
        // "no". Keeping an orphan costs storage; guessing wrong destroys a
        // live message's file.
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockAttachmentRepo.findSharedObjects.mockRejectedValue(
          new Error('postgrest down'),
        );

        const result = await service.deleteMessage(
          'msg-1',
          'ch-1',
          'user-1',
          false,
        );

        expect(result.is_deleted).toBe(true);
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('still soft-deletes when the attachment lookup fails', async () => {
        // This read used to sit outside the try/catch, so a transient
        // PostgREST error turned a delete that was previously a single row
        // update into a 500 with the message still visible.
        mockAttachmentRepo.findByMessage.mockRejectedValue(
          new Error('postgrest down'),
        );

        const result = await service.deleteMessage(
          'msg-1',
          'ch-1',
          'user-1',
          false,
        );

        expect(result.is_deleted).toBe(true);
      });

      it('still purges the second bucket when the first fails', async () => {
        const archived = {
          ...attachment,
          id: 'att-2',
          bucket: 'chat-archive',
          storage_path: 'chapters/ch-1/chat-archive/ch-chan-1/old.png',
        };
        mockAttachmentRepo.findByMessage.mockResolvedValue([
          uploaded,
          archived,
        ]);
        mockStorageProvider.deleteFiles.mockImplementation(
          async (bucket: string) => {
            if (bucket === 'chat') throw new Error('chat bucket down');
          },
        );

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
        );
      });

      it('touches Storage not at all for a message with no attachments', async () => {
        mockAttachmentRepo.findByMessage.mockResolvedValue([]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockAttachmentRepo.findSharedObjects).not.toHaveBeenCalled();
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      // An open report holds what it snapshotted (#2481): the sender's own
      // delete must not destroy the evidence the report exists for.
      it('keeps an object an open report holds, and still purges the rest', async () => {
        const photo = {
          ...attachment,
          id: 'att-photo',
          storage_path: 'chapters/ch-1/chat/ch-chan-1/u/photo.png',
          filename: 'photo.png',
        };
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded, photo]);
        mockReportRepo.findHeldObjects.mockResolvedValue([
          {
            bucket: 'chat',
            storage_path: photo.storage_path,
            heldOpen: true,
            pendingSince: null,
          },
          // A path the message never had: ignored.
          {
            bucket: 'chat',
            storage_path: 'chapters/ch-1/chat/other.png',
            heldOpen: true,
            pendingSince: null,
          },
        ]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockReportRepo.findHeldObjects).toHaveBeenCalledWith('ch-1');
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledTimes(1);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          uploaded.storage_path,
        ]);
      });

      it('keeps an object a claimed report holds while its removal is in flight', async () => {
        // A removal moves its report to `actioned` before it deletes the
        // message, and may withdraw the claim. A sender delete landing in
        // between must not purge the evidence of a report that reopens: the
        // hold lasts until the release, not until the status changes.
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockReportRepo.findHeldObjects.mockResolvedValue([
          {
            bucket: 'chat',
            storage_path: uploaded.storage_path,
            heldOpen: false,
            pendingSince: '2026-09-30T11:59:00.000Z',
          },
        ]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockReportRepo.findHeldObjects).toHaveBeenCalledWith('ch-1');
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('keeps an object held by a report on another message that reaches it', async () => {
        // #1622: two messages can point at one object. The hold is asked by
        // object, so a report on the *other* message keeps it here too.
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockReportRepo.findHeldObjects.mockResolvedValue([
          {
            bucket: 'chat',
            storage_path: uploaded.storage_path,
            heldOpen: true,
          },
        ]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('keeps every object when the report hold cannot be read', async () => {
        // Fail closed, like the shared check: an orphan costs storage, a wrong
        // "nothing is held" destroys a report's evidence.
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockReportRepo.findHeldObjects.mockRejectedValue(
          new Error('postgrest down'),
        );

        const result = await service.deleteMessage(
          'msg-1',
          'ch-1',
          'user-1',
          false,
        );

        expect(result.is_deleted).toBe(true);
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('does not ask for report holds when every object is shared', async () => {
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockAttachmentRepo.findSharedObjects.mockResolvedValue([
          { bucket: 'chat', storage_path: uploaded.storage_path },
        ]);

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(mockReportRepo.findHeldObjects).not.toHaveBeenCalled();
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('purges only after the message is flagged deleted', async () => {
        // Ordering is load-bearing: `listMessageAttachments` 404s an
        // `is_deleted` message, so once the flag lands the files are
        // unreachable whatever Storage does next. Purging first and then
        // failing the update would leave a visible message with dead
        // downloads.
        const order: string[] = [];
        mockAttachmentRepo.findByMessage.mockResolvedValue([uploaded]);
        mockMessageRepo.update.mockImplementation(async () => {
          order.push('update');
          return { ...baseMessage, is_deleted: true };
        });
        mockStorageProvider.deleteFiles.mockImplementation(async () => {
          order.push('deleteFiles');
        });

        await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

        expect(order).toEqual(['update', 'deleteFiles']);
      });
    });
  });

  // ── Pins ─────────────────────────────────────────────────────────────

  // #3921: one flag per message; anyone may add one, only the sender, the
  // flagger or an officer may replace or remove it.
  describe('message flags', () => {
    const flagged = {
      ...baseMessage,
      flag: 'important' as const,
      flagged_by: 'user-flagger',
      flagged_at: '2026-01-02T00:00:00.000Z',
    };

    it('lets any reader flag an unflagged message, guarded on it staying unflagged', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.compareAndSetFlag.mockImplementation(
        async (_id, _expected, data) => ({ ...baseMessage, ...data }),
      );

      const result = await service.setMessageFlag(
        'msg-1',
        'ch-1',
        'user-2',
        false,
        'important',
      );

      expect(mockMessageRepo.compareAndSetFlag).toHaveBeenCalledWith(
        'msg-1',
        { flag: null, flagged_by: null, requireLive: true },
        expect.objectContaining({ flag: 'important', flagged_by: 'user-2' }),
      );
      expect(result).toMatchObject({
        flag: 'important',
        flagged_by: 'user-2',
        sender_blocked: false,
      });
    });

    it('refuses a bystander replacing someone else’s flag', async () => {
      mockMessageRepo.findById.mockResolvedValue(flagged);

      await expect(
        service.setMessageFlag('msg-1', 'ch-1', 'user-2', false, 'funny'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.clearMessageFlag('msg-1', 'ch-1', 'user-2', false),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.compareAndSetFlag).not.toHaveBeenCalled();
    });

    it.each([
      ['the sender', 'user-1', false],
      ['whoever added it', 'user-flagger', false],
      ['an officer', 'user-officer', true],
    ])('lets %s replace the flag', async (_who, userId, isOfficer) => {
      mockMessageRepo.findById.mockResolvedValue(flagged);
      mockMessageRepo.compareAndSetFlag.mockImplementation(
        async (_id, _expected, data) => ({ ...flagged, ...data }),
      );

      await service.setMessageFlag('msg-1', 'ch-1', userId, isOfficer, 'fyi');

      expect(mockMessageRepo.compareAndSetFlag).toHaveBeenCalledWith(
        'msg-1',
        { flag: 'important', flagged_by: 'user-flagger', requireLive: true },
        expect.objectContaining({ flag: 'fyi', flagged_by: userId }),
      );
    });

    it('refuses a message in a channel the caller cannot read, before any write', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.setMessageFlag('msg-1', 'ch-1', 'user-2', false, 'important'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.clearMessageFlag('msg-1', 'ch-1', 'user-2', true),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.compareAndSetFlag).not.toHaveBeenCalled();
    });

    it('masks the flagged message it answers with, for a sender the caller has blocked', async () => {
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-1']);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.compareAndSetFlag.mockImplementation(
        async (_id, _expected, data) => ({ ...baseMessage, ...data }),
      );

      const result = await service.setMessageFlag(
        'msg-1',
        'ch-1',
        'user-2',
        false,
        'funny',
      );

      expect(result).toMatchObject({
        content: BLOCKED_MESSAGE_CONTENT,
        sender_blocked: true,
        flag: null,
      });
    });

    it('answers 409 when the flag changed between the check and the write', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockMessageRepo.compareAndSetFlag.mockResolvedValue(null);

      await expect(
        service.setMessageFlag('msg-1', 'ch-1', 'user-2', false, 'important'),
      ).rejects.toThrow(ConflictException);
    });

    it('treats setting the flag a message already has as done, for anyone', async () => {
      mockMessageRepo.findById.mockResolvedValue(flagged);

      const result = await service.setMessageFlag(
        'msg-1',
        'ch-1',
        'user-2',
        false,
        'important',
      );

      expect(result.flag).toBe('important');
      expect(mockMessageRepo.compareAndSetFlag).not.toHaveBeenCalled();
    });

    it('refuses to flag a deleted message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await expect(
        service.setMessageFlag('msg-1', 'ch-1', 'user-1', false, 'important'),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears all three fields, and is a no-op on an unflagged message', async () => {
      mockMessageRepo.findById.mockResolvedValue(flagged);
      mockMessageRepo.compareAndSetFlag.mockImplementation(
        async (_id, _expected, data) => ({ ...flagged, ...data }),
      );

      await service.clearMessageFlag('msg-1', 'ch-1', 'user-flagger', false);
      expect(mockMessageRepo.compareAndSetFlag).toHaveBeenCalledWith(
        'msg-1',
        { flag: 'important', flagged_by: 'user-flagger', requireLive: false },
        { flag: null, flagged_by: null, flagged_at: null },
      );

      mockMessageRepo.compareAndSetFlag.mockClear();
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      await service.clearMessageFlag('msg-1', 'ch-1', 'user-2', false);
      expect(mockMessageRepo.compareAndSetFlag).not.toHaveBeenCalled();
    });

    it('withholds a blocked flagger’s id but keeps the flag', async () => {
      mockMessageRepo.findById.mockResolvedValue(flagged);
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-flagger']);

      const result = await service.setMessageFlag(
        'msg-1',
        'ch-1',
        'user-2',
        false,
        'important',
      );

      expect(result).toMatchObject({ flag: 'important', flagged_by: null });
    });

    it('clears the flag when the message is deleted', async () => {
      mockMessageRepo.findById.mockResolvedValue(flagged);
      mockMessageRepo.update.mockResolvedValue({
        ...flagged,
        is_deleted: true,
      });

      await service.deleteMessage('msg-1', 'ch-1', 'user-1', false);

      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({
          flag: null,
          flagged_by: null,
          flagged_at: null,
        }),
      );
    });
  });

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

    it('refuses to pin a deleted message (#1575)', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
        payload: { name: 'Standards Board — Doe hearing' },
      });

      await expect(
        service.pinMessage('msg-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('Cannot pin a deleted message');
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
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

    it('answers a deleted message without the card data a pre-#1575 delete left behind', async () => {
      // A pinned card deleted before the delete cleared `payload` still holds
      // it in the row; the unpin answer must not hand it back.
      const deletedCard = {
        ...baseMessage,
        kind: 'event' as const,
        content: '[message deleted]',
        is_deleted: true,
        is_pinned: true,
        payload: { name: 'Standards Board — Doe hearing' },
      };
      mockMessageRepo.findById.mockResolvedValue(deletedCard);
      mockMessageRepo.update.mockResolvedValue({
        ...deletedCard,
        is_pinned: false,
      });

      const result = await service.unpinMessage('msg-1', 'ch-1', 'user-1');
      expect(result.payload).toBeNull();
      expect(result.is_deleted).toBe(true);
    });

    it('should reject unpinning non-pinned message', async () => {
      mockMessageRepo.findById.mockResolvedValue(baseMessage);

      await expect(
        service.unpinMessage('msg-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // #2311, option 1 (owner decision 2026-09-22): an OPEN report lets a
  // `channels:manage` holder remove exactly the message it names — including
  // one in a DM they are not in — and nothing else. Run over the REAL
  // ChannelAccessService wired above, so the DM predicate is the one that ships.
  describe('deleteReportedMessage (report-scoped removal)', () => {
    const OFFICER = 'user-officer';
    const dmChannel: ChatChannel = {
      ...baseChannel,
      id: 'ch-dm',
      name: 'dm-user-1-user-2',
      type: 'DM',
      member_ids: ['user-1', 'user-2'],
    };
    const reportedMessage: ChatMessage = {
      ...baseMessage,
      id: 'msg-reported',
      channel_id: 'ch-dm',
      sender_id: 'user-2',
      content: 'you are worthless',
    };
    const siblingMessage: ChatMessage = {
      ...reportedMessage,
      id: 'msg-sibling',
      content: 'a message nobody reported',
    };
    const openReport: ChatMessageReportView = {
      id: 'report-1',
      chapter_id: 'ch-1',
      message_id: 'msg-reported',
      channel_id: 'chan-1',
      reported_content: 'you are worthless',
      reported_sender_id: 'user-2',
      reported_author_name: null,
      reason: 'harassment',
      details: null,
      status: 'open',
      created_at: '2026-01-01T12:05:00.000Z',
      resolved_at: null,
      resolved_by: null,
      reported_attachments: [],
    };
    const grantFor = (report: ChatMessageReportView = openReport) =>
      ReportedMessageGrant.fromOpenReport(report);

    beforeEach(() => {
      mockChannelRepo.findById.mockResolvedValue(dmChannel);
      mockMessageRepo.findById.mockImplementation((id: string) =>
        Promise.resolve(
          id === reportedMessage.id
            ? reportedMessage
            : id === siblingMessage.id
              ? siblingMessage
              : null,
        ),
      );
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        ...baseMember,
        user_id: OFFICER,
      });
      // The officer is a President: the wildcard is exactly the permission the
      // DM predicate refuses to honour, which is what makes this the hard case.
      mockRbac.getEffectivePermissions.mockResolvedValue(['*']);
      mockMessageRepo.update.mockResolvedValue({
        ...reportedMessage,
        content: '[message deleted]',
        is_deleted: true,
      });
    });

    it('removes the reported DM message through the ordinary soft delete', async () => {
      await service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER);

      expect(mockChannelRepo.findById).toHaveBeenCalledWith('ch-dm', 'ch-1');
      expect(mockMessageRepo.update).toHaveBeenCalledTimes(1);
      expect(mockMessageRepo.update).toHaveBeenCalledWith('msg-reported', {
        content: '[message deleted]',
        is_deleted: true,
        metadata: {},
        payload: null,
        flag: null,
        flagged_by: null,
        flagged_at: null,
      });
      // Same tail as `deleteMessage`: the attachment purge runs, scoped to the
      // chapter.
      expect(mockAttachmentRepo.findByMessage).toHaveBeenCalledWith(
        'msg-reported',
        'ch-1',
      );
    });

    it('returns nothing from the DM to the officer but the channel id', async () => {
      // Whether it removed anything, and the channel's id so the client can
      // blank that one cached timeline — no content, no channel row, no
      // message row.
      await expect(
        service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER),
      ).resolves.toEqual({ alreadyDeleted: false, channelId: 'ch-dm' });
    });

    it('does not open the thread: the officer still cannot read the DM', async () => {
      // "A report about a DM does not open the DM to officers." Only the
      // delete path accepts a grant; every read goes through the unchanged
      // predicate.
      await expect(
        service.getMessages('ch-dm', 'ch-1', OFFICER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.findByChannel).not.toHaveBeenCalled();
    });

    it('does not open the sibling messages to the ordinary delete route', async () => {
      // `DELETE /v1/channels/messages/:id` for any other message in the DM is
      // still the 403 it was, wildcard or not.
      await expect(
        service.deleteMessage('msg-sibling', 'ch-1', OFFICER, true),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('answers an already-deleted message as such, writing nothing', async () => {
      // Its sender, an ordinary delete, a sibling report's removal or an
      // earlier half-finished attempt got there first. Not an error — the
      // report still has to close — but nothing is removed now, and the caller
      // is told so it does not claim a removal it did not make.
      mockMessageRepo.findById.mockResolvedValue({
        ...reportedMessage,
        content: '[message deleted]',
        is_deleted: true,
      });

      await expect(
        service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER),
      ).resolves.toEqual({ alreadyDeleted: true, channelId: 'ch-dm' });
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
      expect(mockAttachmentRepo.findByMessage).not.toHaveBeenCalled();
    });

    it('404s a message that no longer exists', async () => {
      mockMessageRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a grant minted in another chapter', async () => {
      // The caller's active chapter and the report's chapter are sourced
      // independently; a mismatch grants nothing.
      const foreign = grantFor({ ...openReport, chapter_id: 'ch-other' });

      await expect(
        service.deleteReportedMessage(foreign, 'ch-1', OFFICER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('404s when the message channel is not in the caller chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a caller who is not a member of the chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('also removes a reported message in a channel (non-DM) the officer is not in', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        id: 'ch-dm',
        type: 'PRIVATE',
        member_ids: ['user-1', 'user-2'],
      });

      await service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER);

      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-reported',
        expect.objectContaining({ is_deleted: true }),
      );
    });

    it('also removes a reported message in a PUBLIC channel', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        id: 'ch-dm',
      });

      await service.deleteReportedMessage(grantFor(), 'ch-1', OFFICER);

      expect(mockMessageRepo.update).toHaveBeenCalledTimes(1);
    });

    describe('reportedMessageState', () => {
      it('says whether the message is still there, and its channel, with no content', async () => {
        await expect(
          service.reportedMessageState('msg-reported', 'ch-1'),
        ).resolves.toEqual({ channelId: 'ch-dm', isDeleted: false });
        // Chapter-scoped like every message path: the channel must resolve in
        // the chapter asked about.
        expect(mockChannelRepo.findById).toHaveBeenCalledWith('ch-dm', 'ch-1');
      });

      it('reports a soft-deleted message as deleted', async () => {
        mockMessageRepo.findById.mockResolvedValue({
          ...reportedMessage,
          is_deleted: true,
        });

        await expect(
          service.reportedMessageState('msg-reported', 'ch-1'),
        ).resolves.toEqual({ channelId: 'ch-dm', isDeleted: true });
      });

      it('is null for a message that no longer exists', async () => {
        mockMessageRepo.findById.mockResolvedValue(null);

        await expect(
          service.reportedMessageState('msg-reported', 'ch-1'),
        ).resolves.toBeNull();
      });

      it('is null for a message whose channel is not in the chapter', async () => {
        mockChannelRepo.findById.mockResolvedValue(null);

        await expect(
          service.reportedMessageState('msg-reported', 'ch-other'),
        ).resolves.toBeNull();
      });

      it('writes nothing', async () => {
        await service.reportedMessageState('msg-reported', 'ch-1');
        expect(mockMessageRepo.update).not.toHaveBeenCalled();
      });
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

  // ── Read Receipts ────────────────────────────────────────────────────

  describe('markChannelRead', () => {
    it('should upsert read receipt', async () => {
      mockReadReceiptRepo.upsert.mockResolvedValue({
        id: 'rr-1',
        channel_id: 'ch-chan-1',
        user_id: 'user-1',
        last_read_at: '2026-01-01T12:00:00.000Z',
        hidden_at: null,
        updated_at: '2026-01-01T12:00:00.000Z',
      });

      const result = await service.markChannelRead(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );
      expect(result.channel_id).toBe('ch-chan-1');
    });

    it('clears the chat notifications the read covers, through the receipt instant (#3788)', async () => {
      mockReadReceiptRepo.upsert.mockImplementation(
        async (channelId, userId, lastReadAt) => ({
          id: 'rr-1',
          channel_id: channelId,
          user_id: userId,
          last_read_at: lastReadAt,
          hidden_at: null,
          updated_at: lastReadAt,
        }),
      );

      const result = await service.markChannelRead(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );

      expect(
        mockNotificationService.markChatChannelNotificationsRead,
      ).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        'ch-chan-1',
        result.last_read_at,
      );
    });

    it('still returns the receipt when clearing the notifications fails', async () => {
      mockReadReceiptRepo.upsert.mockResolvedValue({
        id: 'rr-1',
        channel_id: 'ch-chan-1',
        user_id: 'user-1',
        last_read_at: '2026-01-01T12:00:00.000Z',
        hidden_at: null,
        updated_at: '2026-01-01T12:00:00.000Z',
      });
      mockNotificationService.markChatChannelNotificationsRead.mockRejectedValueOnce(
        new Error('db down'),
      );

      const result = await service.markChannelRead(
        'ch-chan-1',
        'ch-1',
        'user-1',
      );

      expect(result.channel_id).toBe('ch-chan-1');
    });

    it('leaves the notifications alone when the receipt fails', async () => {
      mockReadReceiptRepo.upsert.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.markChannelRead('ch-chan-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('db down');
      expect(
        mockNotificationService.markChatChannelNotificationsRead,
      ).not.toHaveBeenCalled();
    });
  });

  // ── File Upload ─────────────────────────────────────────────────────

  /**
   * Minting an upload URL and sending a message are the same authorization
   * question, so for any channel and any caller the two must reach the same
   * verdict. Each row asserts both halves of that: the verdict itself, and that
   * mint and send arrived at it together.
   *
   * Both halves earn their place. Pinning only the verdict would miss the two
   * drifting apart in a direction the table did not anticipate; asserting only
   * that they agree would pass if someone loosened both at once, which is how
   * #2186 would come back. Note the table guards over-tightening as much as
   * under-tightening — the DM, private, and role-gated rows fail if the mint
   * starts refusing callers `sendMessage` still accepts.
   */
  describe('mint and send agree', () => {
    type Verdict = 'allowed' | 'denied';

    /**
     * Scores only the channel-access 403 as a denial. `sendMessage` can throw
     * `ForbiddenException` for a second, unrelated reason (`SERVER_ONLY_KINDS`)
     * that the mint has no counterpart for, so treating every 403 as an
     * authorization answer would let two different refusals read as agreement.
     * Anything else — a 404, a validation error, a mock left unprimed — is a
     * broken test rather than a verdict, and rethrowing surfaces it as one.
     */
    const CHANNEL_ACCESS_DENIED = 'You do not have access to this channel';

    const verdictOf = async (
      call: () => Promise<unknown>,
    ): Promise<Verdict> => {
      try {
        await call();
        return 'allowed';
      } catch (error) {
        if (
          error instanceof ForbiddenException &&
          error.message === CHANNEL_ACCESS_DENIED
        ) {
          return 'denied';
        }
        throw error;
      }
    };

    const cases: {
      name: string;
      channel: Partial<ChatChannel>;
      holder?: ChannelAccessHolder;
      expected: Verdict;
    }[] = [
      {
        name: 'an ordinary member in a public channel',
        channel: {},
        expected: 'allowed',
      },
      {
        name: 'a participant in a private channel',
        channel: { type: 'PRIVATE', member_ids: ['user-1', 'user-2'] },
        expected: 'allowed',
      },
      {
        name: 'a non-participant in a private channel',
        channel: { type: 'PRIVATE', member_ids: ['user-2'] },
        expected: 'denied',
      },
      {
        name: 'a participant in a DM',
        channel: { type: 'DM', member_ids: ['user-1', 'user-2'] },
        expected: 'allowed',
      },
      {
        name: 'a participant in a group DM',
        channel: { type: 'GROUP_DM', member_ids: ['user-1', 'user-2'] },
        expected: 'allowed',
      },
      {
        name: "a member left off a channel's who-can-post list",
        channel: { is_read_only: true, who_can_post: [OFFICERS] },
        expected: 'denied',
      },
      {
        name: "an officer on a channel's who-can-post list",
        channel: { is_read_only: true, who_can_post: [OFFICERS] },
        holder: holderOf(OFFICERS),
        expected: 'allowed',
      },
      {
        name: 'the President in a channel with a who-can-post list',
        channel: { is_read_only: true, who_can_post: [OFFICERS] },
        holder: WILDCARD,
        expected: 'allowed',
      },
      {
        name: 'a member in an archived channel',
        channel: { archived_at: '2026-01-02T00:00:00.000Z' },
        expected: 'denied',
      },
      {
        // With a who-can-post list, so the wildcard actually reaches the
        // predicate and the row proves `*` does not beat the archive freeze.
        name: 'the President in an archived channel (no override exists)',
        channel: {
          is_read_only: true,
          who_can_post: [OFFICERS],
          archived_at: '2026-01-02T00:00:00.000Z',
        },
        holder: WILDCARD,
        expected: 'denied',
      },
      {
        name: "a member left off a channel's who-can-see list",
        channel: { type: 'ROLE_GATED', who_can_see: [OFFICERS] },
        expected: 'denied',
      },
      {
        name: "a member on a channel's who-can-see list",
        channel: { type: 'ROLE_GATED', who_can_see: [OFFICERS] },
        holder: holderOf(OFFICERS),
        expected: 'allowed',
      },
      {
        name: 'an alumni member in an operational channel',
        channel: {},
        holder: ALUMNUS,
        expected: 'denied',
      },
      {
        // A private channel is operational too: only a DM, a group DM or a
        // channel whose lists name the Alumni role takes their posts.
        name: 'an alumni member in a private channel they belong to',
        channel: { type: 'PRIVATE', member_ids: ['user-1', 'user-2'] },
        holder: ALUMNUS,
        expected: 'denied',
      },
      {
        name: 'an alumni member in a DM',
        channel: { type: 'DM', member_ids: ['user-1', 'user-2'] },
        holder: ALUMNUS,
        expected: 'allowed',
      },
      {
        name: 'an alumni member in the alumni channel',
        channel: {
          type: 'ROLE_GATED',
          who_can_see: [OFFICERS, `role:${ALUMNI_ROLE}`],
        },
        holder: ALUMNUS,
        expected: 'allowed',
      },
      {
        name: 'an alumni member who is also President',
        channel: {},
        holder: { ...ALUMNUS, wildcard: true },
        expected: 'allowed',
      },
    ];

    it.each(cases)('agrees on $name', async ({ channel, holder, expected }) => {
      mockChannelRepo.findById.mockResolvedValue({
        ...baseChannel,
        ...channel,
      });
      mockRbac.getChannelAccessHolder.mockResolvedValue(
        holder ?? EMPTY_ACCESS_HOLDER,
      );
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );
      mockMessageRepo.create.mockResolvedValue(baseMessage);

      const mint = await verdictOf(() =>
        attachments.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'photo.png',
          'image/png',
        ),
      );
      const send = await verdictOf(() =>
        service.sendMessage({
          chapter_id: 'ch-1',
          channel_id: 'ch-chan-1',
          sender_id: 'user-1',
          content: 'Hello world',
        }),
      );

      expect({ mint, send }).toEqual({ mint: expected, send: expected });
    });
  });

  // ── Notification triggers ──────────────────────────────────────────
  //
  // None. `sendMessage` pushes nothing itself: the chat push worker is the only
  // chat push path (#2771), and its DM, announcement, mute and block cases are
  // proven in `chat-push-worker.service.spec.ts`. `ChatService` no longer
  // injects `NotificationService` at all, and `chat-read-surface-ledger.spec.ts`
  // fails if a notify call reappears in this file.

  describe('getLatestMessages', () => {
    const latest = (channelId: string) => ({
      channel_id: channelId,
      message_id: `m-${channelId}`,
      sender_id: 'user-2',
      author_name: null,
      content: 'see you at 6',
      kind: 'text',
      payload: null,
      attachment_count: 0,
      created_at: '2026-11-06T18:00:00Z',
    });

    it('drops channels the caller cannot read, and DMs they hid', async () => {
      // A preview says far more than a count about a conversation between two
      // other members, so this filter carries the same weight as the unread one.
      const theirs: ChatChannel = {
        ...baseChannel,
        id: 'private-not-mine',
        type: 'PRIVATE',
        member_ids: ['someone-else', 'another'],
      };
      const hiddenDm: ChatChannel = {
        ...baseChannel,
        id: 'ch-dm',
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findByIds.mockResolvedValue([
        baseChannel,
        theirs,
        hiddenDm,
      ]);
      mockMessageRepo.findLatestPerChannel.mockResolvedValue([
        latest(baseChannel.id),
        latest(theirs.id),
        latest(hiddenDm.id),
      ]);
      mockReadReceiptRepo.findHiddenChannelIds.mockResolvedValue(
        new Set([hiddenDm.id]),
      );

      await expect(
        service.getLatestMessages('ch-1', 'user-1'),
      ).resolves.toEqual([latest(baseChannel.id)]);
      expect(mockMessageRepo.findLatestPerChannel).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
    });

    it('answers an empty list without an access lookup when no channel has a message', async () => {
      mockMessageRepo.findLatestPerChannel.mockResolvedValue([]);

      await expect(
        service.getLatestMessages('ch-1', 'user-1'),
      ).resolves.toEqual([]);
      expect(mockChannelRepo.findByIds).not.toHaveBeenCalled();
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
      mockChannelRepo.findByIds.mockResolvedValue([
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

    // #2303: a hidden DM has no row on screen, so its count would light the
    // app badge with nothing to clear it from — the blocked-sender case above
    // all, since a blocked member's post never brings the thread back.
    it('drops a DM the caller has hidden', async () => {
      const dm: ChatChannel = {
        ...baseChannel,
        id: 'ch-dm',
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };
      mockChannelRepo.findByIds.mockResolvedValue([baseChannel, dm]);
      mockReadReceiptRepo.getUnreadCounts.mockResolvedValue([
        { channel_id: baseChannel.id, unread_count: 1, mention_count: 0 },
        { channel_id: dm.id, unread_count: 3, mention_count: 0 },
      ]);
      mockReadReceiptRepo.findHiddenChannelIds.mockResolvedValue(
        new Set([dm.id]),
      );

      await expect(service.getUnreadCounts('ch-1', 'user-1')).resolves.toEqual([
        { channel_id: baseChannel.id, unread_count: 1, mention_count: 0 },
      ]);
    });

    it('keeps every count when the hidden lookup fails', async () => {
      mockChannelRepo.findByIds.mockResolvedValue([baseChannel]);
      mockReadReceiptRepo.getUnreadCounts.mockResolvedValue([
        { channel_id: baseChannel.id, unread_count: 2, mention_count: 0 },
      ]);
      mockReadReceiptRepo.findHiddenChannelIds.mockRejectedValue(
        new Error('down'),
      );

      await expect(service.getUnreadCounts('ch-1', 'user-1')).resolves.toEqual([
        { channel_id: baseChannel.id, unread_count: 2, mention_count: 0 },
      ]);
    });

    it('keeps a readable channel with nothing unread rather than dropping it', async () => {
      // The list needs a row per channel to render; a zero is a real answer.
      mockChannelRepo.findByIds.mockResolvedValue([baseChannel]);
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
      expect(mockChannelRepo.findByIds).not.toHaveBeenCalled();
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('returns nothing for a non-member rather than the whole chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockChannelRepo.findByIds.mockResolvedValue([baseChannel]);
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
      { user_id: 'user-1', display_name: 'Sender One', role_ids: ['r-member'] },
      {
        user_id: 'user-2',
        display_name: 'Jane Doe',
        role_ids: ['r-member', 'r-officers'],
      },
      { user_id: 'user-3', display_name: 'Janet Roe', role_ids: ['r-member'] },
    ];

    function seedRoster() {
      mockMemberRepo.findChapterMemberIdentities.mockResolvedValue(roster);
    }

    const role = (
      id: string,
      name: string,
      extra: Partial<{
        system_key: string | null;
        display_order: number;
        mentionable: boolean;
      }> = {},
    ) => ({
      id,
      chapter_id: 'ch-1',
      name,
      system_key: null,
      permissions: [],
      is_system: false,
      display_order: 1,
      color: null,
      mentionable: true,
      created_at: '2026-11-06T00:00:00Z',
      ...extra,
    });

    describe('role mentions (2026-11-06)', () => {
      beforeEach(() => {
        seedRoster();
        mockRbac.findByChapter.mockResolvedValue([
          role('r-officers', 'Officers'),
          // The Everyone role (#4191): pinged as @everyone, off by default.
          role('r-member', 'Everyone', {
            system_key: 'MEMBER',
            display_order: 9,
            mentionable: false,
          }),
        ]);
        mockMessageRepo.create.mockResolvedValue(baseMessage);
      });

      async function send(content: string, senderId = 'user-1') {
        await service.sendMessage({
          channel_id: 'ch-chan-1',
          chapter_id: 'ch-1',
          sender_id: senderId,
          content,
        });
        return mockMessageRepo.create.mock.calls.at(-1)?.[0]?.mentions;
      }

      it('expands a role to everyone holding it', async () => {
        await expect(send('@Officers meeting at 8')).resolves.toEqual([
          'user-2',
        ]);
        // A role whose switch is on never needs the sender's permissions.
        expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalledWith(
          'ch-1',
          'user-1',
        );
      });

      it('lets a member ping nobody through a role an officer switched off', async () => {
        mockRbac.getEffectivePermissions.mockResolvedValue(['members:view']);
        await expect(send('@everyone read this')).resolves.toEqual([]);
        expect(mockRbac.getEffectivePermissions).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
        );
      });

      it('lets an officer ping a role that is switched off', async () => {
        mockRbac.getEffectivePermissions.mockResolvedValue(['channels:manage']);
        await expect(send('@everyone read this')).resolves.toEqual([
          'user-1',
          'user-2',
          'user-3',
        ]);
      });

      it('lets anyone ping a role whose switch is on, however big', async () => {
        // On by default (owner, 2026-11-06): a role everyone holds included.
        mockRbac.findByChapter.mockResolvedValue([
          role('r-member', 'Brothers'),
        ]);
        await expect(send('@Brothers hi')).resolves.toEqual([
          'user-1',
          'user-2',
          'user-3',
        ]);
        expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalledWith(
          'ch-1',
          'user-1',
        );
      });

      it('re-resolves a role mention on edit as the editor', async () => {
        mockMessageRepo.findById.mockResolvedValue({
          ...baseMessage,
          sender_id: 'user-1',
        });
        mockMessageRepo.update.mockResolvedValue(baseMessage);
        await service.editMessage('msg-1', 'ch-1', 'user-1', 'cc @Officers');
        expect(mockMessageRepo.update).toHaveBeenCalledWith(
          'msg-1',
          expect.objectContaining({ mentions: ['user-2'] }),
        );
      });
    });

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

    // #3844: a reply pings the author it quotes, as an @mention does.
    describe('a reply counts as a mention of the quoted author', () => {
      const quoted = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
        ...baseMessage,
        id: 'msg-quoted',
        sender_id: 'user-2',
        ...overrides,
      });
      const reply = (content = 'agreed') =>
        service.sendMessage({
          channel_id: 'ch-chan-1',
          chapter_id: 'ch-1',
          sender_id: 'user-1',
          content,
          reply_to_id: 'msg-quoted',
        });
      const stored = () =>
        mockMessageRepo.create.mock.calls.at(-1)?.[0]?.mentions;
      // The reply being edited, and what the quoted message reads as now.
      const editReply = async (
        previousMentions: string[],
        quotedNow: ChatMessage | Error,
        content = 'agreed, edited',
      ) => {
        mockMessageRepo.findById.mockImplementation((id: string) =>
          id === 'msg-quoted'
            ? quotedNow instanceof Error
              ? Promise.reject(quotedNow)
              : Promise.resolve(quotedNow)
            : Promise.resolve({
                ...baseMessage,
                reply_to_id: 'msg-quoted',
                mentions: previousMentions,
              }),
        );
        mockMessageRepo.update.mockResolvedValue(baseMessage);
        await service.editMessage('msg-1', 'ch-1', 'user-1', content);
        return mockMessageRepo.update.mock.calls.at(-1)?.[1]?.mentions;
      };

      beforeEach(() => {
        seedRoster();
        mockMessageRepo.create.mockResolvedValue(baseMessage);
      });

      it('adds the quoted author to mentions', async () => {
        mockMessageRepo.findById.mockResolvedValue(quoted());
        await reply();
        expect(stored()).toEqual(['user-2']);
      });

      it('lists the author once when the reply also @mentions them', async () => {
        mockMessageRepo.findById.mockResolvedValue(quoted());
        await reply('@janedoe agreed');
        expect(stored()).toEqual(['user-2']);
      });

      it.each([
        ['a reply to yourself', { sender_id: 'user-1' }],
        ['a row with no linked member', { sender_id: null }],
        ['a system row', { sender_id: SYSTEM_SENDER_ID }],
        ['a deleted message', { is_deleted: true }],
      ] as Array<[string, Partial<ChatMessage>]>)(
        'pings nobody for %s',
        async (_label, overrides) => {
          mockMessageRepo.findById.mockResolvedValue(quoted(overrides));
          await reply();
          expect(stored()).toEqual([]);
        },
      );

      it('pings through a block, as a typed @mention does', async () => {
        // Dropping the author would show the replier `mentions: []` where
        // every other reply shows the author: a "who blocked me" oracle.
        // Delivery applies blocks instead (push worker, unread counts).
        mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-2']);
        mockMessageRepo.findById.mockResolvedValue(quoted());
        await reply();
        expect(stored()).toEqual(['user-2']);
      });

      it('keeps the ping through an edit', async () => {
        await expect(editReply(['user-2'], quoted())).resolves.toEqual([
          'user-2',
        ]);
      });

      it('keeps it even after the quoted message is deleted', async () => {
        await expect(
          editReply(['user-2'], quoted({ is_deleted: true })),
        ).resolves.toEqual(['user-2']);
      });

      it('does not add a ping the send never stored', async () => {
        await expect(editReply([], quoted())).resolves.toEqual([]);
      });

      it('keeps the stored mentions when the quoted message cannot be read', async () => {
        await expect(
          editReply(['user-2'], new Error('pg down')),
        ).resolves.toEqual(['user-2']);
      });

      it('still drops a body mention the edit removed', async () => {
        await expect(
          editReply(['user-3', 'user-2'], quoted(), 'never mind'),
        ).resolves.toEqual(['user-2']);
      });
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

describe('tombstoneMetadata (#2878)', () => {
  it('keeps only the import id on an imported row', () => {
    expect(
      tombstoneMetadata({
        kind: 'imported',
        metadata: { discord_import_id: 'imp-1', attachment_count: 3 },
      }),
    ).toEqual({ discord_import_id: 'imp-1' });
  });

  it('wipes everything on any other row, even one carrying the key', () => {
    expect(
      tombstoneMetadata({
        kind: 'text',
        metadata: { discord_import_id: 'imp-1', poll: true },
      }),
    ).toEqual({});
  });

  it('keeps nothing when the imported row has no string import id', () => {
    expect(tombstoneMetadata({ kind: 'imported', metadata: {} })).toEqual({});
    expect(
      tombstoneMetadata({
        kind: 'imported',
        metadata: { discord_import_id: 7 },
      }),
    ).toEqual({});
  });
});
