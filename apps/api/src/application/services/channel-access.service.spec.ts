import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelAccessService,
  ReportedMessageGrant,
} from './channel-access.service';
import type { ChatMessageReportView } from '#domain/entities/chat-moderation.entity';
import { RbacService } from './rbac.service';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { ChatChannel, ChatMessage } from '#domain/entities/chat.entity';
import type { Member } from '#domain/entities/member.entity';
import {
  EMPTY_ACCESS_HOLDER,
  type ChannelAccessHolder,
} from '#domain/utils/channel-access';

// What a who-can-see or who-can-post list names (#3722), and the holders
// `RbacService.getChannelAccessHolder` answers with.
const OFFICERS = 'tier:00000000-0000-4000-8000-0000000000e1';
const SECRET = 'role:00000000-0000-4000-8000-00000000c0de';
const ALUMNI = 'role:00000000-0000-4000-8000-0000000a1a11';
const holderOf = (...entries: string[]): ChannelAccessHolder => ({
  ...EMPTY_ACCESS_HOLDER,
  entries: new Set(entries),
});
const WILDCARD: ChannelAccessHolder = {
  ...EMPTY_ACCESS_HOLDER,
  wildcard: true,
};
const ALUMNUS: ChannelAccessHolder = {
  ...holderOf(ALUMNI),
  alumniEntries: new Set([ALUMNI]),
};

describe('ChannelAccessService', () => {
  let service: ChannelAccessService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRbac: {
    getChannelAccessHolder: jest.Mock;
    getChapterMemberAccess: jest.Mock;
  };

  const publicChannel: ChatChannel = {
    id: 'ch-public',
    chapter_id: 'chap-1',
    name: 'general',
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    who_can_see: null,
    who_can_post: null,
    member_ids: null,
    category_id: null,
    is_read_only: false,
    created_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    default_notification_level: null,
    is_default: false,
    is_audit_log: false,
    display_locked: false,
    created_by: null,
  };

  const privateChannel: ChatChannel = {
    ...publicChannel,
    id: 'ch-private',
    type: 'PRIVATE',
    member_ids: ['member-of-private'],
  };

  const roleGatedChannel: ChatChannel = {
    ...publicChannel,
    id: 'ch-role',
    type: 'ROLE_GATED',
    who_can_see: [SECRET],
  };

  const readOnlyChannel: ChatChannel = {
    ...publicChannel,
    id: 'ch-announce',
    is_read_only: true,
    who_can_post: [OFFICERS],
  };

  // Carries real role_ids: the alumni lookup is fed from this row, and a test
  // that leaves them undefined cannot tell a correct call from a garbage one.
  const member = { id: 'm-1', role_ids: ['role-alumni'] } as Member;

  beforeEach(async () => {
    mockChannelRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findDm: jest.fn(),
      findPushRouting: jest.fn(),
      createDm: jest.fn(),
      findByName: jest.fn(),
      findAuditLog: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      leaveGroupDm: jest.fn(),
      findRoleGates: jest.fn(),
      addPrivateChannelMember: jest.fn(),
      removePrivateChannelMember: jest.fn(),
      removeUserFromPrivateChannels: jest.fn(),
      setDefault: jest.fn(),
      reorder: jest.fn(),
    };
    mockMessageRepo = {
      findById: jest.fn(),
      findByChannel: jest.fn(),
      findPinnedByChannel: jest.fn(),
      findImportantInChannel: jest.fn(),
      findLatestPerChannel: jest.fn(),
      countPinnedByChannel: jest.fn(),
      findPollsByChapter: jest.fn(),
      findPollCardsByChapter: jest.fn(),
      findByClientMessageId: jest.fn(),
      findAuthorAvatarPaths: jest.fn(),
      insertIdempotent: jest.fn(),
      compareAndSetFlag: jest.fn(),
      updateIfLive: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockMemberRepo = {
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
    };
    mockRbac = {
      // Default: an active member holding nothing a list names.
      getChannelAccessHolder: jest.fn().mockResolvedValue(EMPTY_ACCESS_HOLDER),
      getChapterMemberAccess: jest.fn().mockResolvedValue([]),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelAccessService,
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
        { provide: CHAT_MESSAGE_REPOSITORY, useValue: mockMessageRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: RbacService, useValue: mockRbac },
      ],
    }).compile();

    service = moduleRef.get(ChannelAccessService);
  });

  describe('assertChannelAccess', () => {
    it('throws 404 when the channel does not resolve within the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.assertChannelAccess('ch-x', 'chap-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows a chapter member to read a PUBLIC channel and returns it', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      const result = await service.assertChannelAccess(
        'ch-public',
        'chap-1',
        'user-1',
      );

      expect(result).toBe(publicChannel);
      // A channel everyone sees needs no role lookup to read.
      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    it('denies a non-member of the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'ghost'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a PRIVATE channel only for a listed member', async () => {
      mockChannelRepo.findById.mockResolvedValue(privateChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      await expect(
        service.assertChannelAccess(
          'ch-private',
          'chap-1',
          'member-of-private',
        ),
      ).resolves.toBe(privateChannel);

      await expect(
        service.assertChannelAccess('ch-private', 'chap-1', 'outsider'),
      ).rejects.toThrow(ForbiddenException);
    });

    it("gates a channel on its who-can-see list, read from the caller's roles", async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      mockRbac.getChannelAccessHolder.mockResolvedValueOnce(holderOf(SECRET));
      await expect(
        service.assertChannelAccess('ch-role', 'chap-1', 'user-1'),
      ).resolves.toBe(roleGatedChannel);
      expect(mockRbac.getChannelAccessHolder).toHaveBeenCalledWith(
        'chap-1',
        member.role_ids,
      );

      mockRbac.getChannelAccessHolder.mockResolvedValueOnce(
        EMPTY_ACCESS_HOLDER,
      );
      await expect(
        service.assertChannelAccess('ch-role', 'chap-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('gates posting on the who-can-post list', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      // Read is fine for any member.
      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'read'),
      ).resolves.toBe(readOnlyChannel);

      // Post is denied off the list...
      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);

      // ...and allowed on it.
      mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(OFFICERS));
      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(readOnlyChannel);
    });

    // #348: an archived Group DM (membership dropped to <= 1 via leave) stays
    // readable by whoever remains in `member_ids`, but is frozen for writes.
    // `canAccessChannel` itself has the unconditional (even a `*` holder
    // can't override it) version of this test — this one just confirms the
    // service wires `archived_at` through to the predicate at all.
    it('lets a remaining member keep reading an archived Group DM but denies posting', async () => {
      const archivedGroupDm: ChatChannel = {
        ...publicChannel,
        id: 'ch-archived',
        type: 'GROUP_DM',
        member_ids: ['user-1'],
        archived_at: '2026-01-02T00:00:00.000Z',
      };
      mockChannelRepo.findById.mockResolvedValue(archivedGroupDm);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      await expect(
        service.assertChannelAccess('ch-archived', 'chap-1', 'user-1', 'read'),
      ).resolves.toBe(archivedGroupDm);

      await expect(
        service.assertChannelAccess('ch-archived', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listChannelMembers', () => {
    const access = [
      {
        user_id: 'president',
        permissions: new Set(['*']),
        top_role_order: 0,
        top_role: { id: 'r-pres', name: 'President' },
        channel_access: WILDCARD,
      },
      {
        user_id: 'member-of-private',
        permissions: new Set<string>(),
        top_role_order: 4,
        top_role: { id: 'r-mem', name: 'Member' },
        channel_access: EMPTY_ACCESS_HOLDER,
      },
      {
        user_id: 'secret-holder',
        permissions: new Set<string>(),
        top_role_order: 2,
        top_role: { id: 'r-sec', name: 'Secret' },
        channel_access: holderOf(SECRET),
      },
      {
        user_id: 'no-role',
        permissions: new Set<string>(),
        top_role_order: null,
        top_role: null,
        channel_access: EMPTY_ACCESS_HOLDER,
      },
    ];

    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockRbac.getChannelAccessHolder.mockResolvedValue(WILDCARD);
      mockRbac.getChapterMemberAccess.mockResolvedValue(access);
    });

    it('lists every chapter member for a PUBLIC channel, with their rank', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      const result = await service.listChannelMembers(
        'ch-public',
        'chap-1',
        'user-1',
      );

      expect(result).toEqual([
        {
          user_id: 'president',
          role_rank: 0,
          role_id: 'r-pres',
          role_name: 'President',
        },
        {
          user_id: 'member-of-private',
          role_rank: 4,
          role_id: 'r-mem',
          role_name: 'Member',
        },
        {
          user_id: 'secret-holder',
          role_rank: 2,
          role_id: 'r-sec',
          role_name: 'Secret',
        },
        { user_id: 'no-role', role_rank: null, role_id: null, role_name: null },
      ]);
      expect(mockRbac.getChapterMemberAccess).toHaveBeenCalledWith('chap-1');
    });

    it('lists only who its who-can-see list names, and the wildcard', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);

      const result = await service.listChannelMembers(
        'ch-role',
        'chap-1',
        'user-1',
      );

      expect(result.map((entry) => entry.user_id)).toEqual([
        'president',
        'secret-holder',
      ]);
      // One chapter-wide resolve, never a lookup per listed member.
      expect(mockRbac.getChapterMemberAccess).toHaveBeenCalledTimes(1);
    });

    it('lists only `member_ids` for a PRIVATE channel, wildcard or not', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...privateChannel,
        member_ids: ['member-of-private', 'user-1'],
      });

      const result = await service.listChannelMembers(
        'ch-private',
        'chap-1',
        'user-1',
      );

      expect(result).toEqual([
        {
          user_id: 'member-of-private',
          role_rank: 4,
          role_id: 'r-mem',
          role_name: 'Member',
        },
      ]);
    });

    it('files an Everyone holder under "Members", never under a role called Everyone (#4191)', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);
      mockRbac.getChapterMemberAccess.mockResolvedValue([
        {
          user_id: 'plain-member',
          permissions: new Set<string>(),
          top_role_order: 4,
          top_role: { id: 'r-everyone', name: 'Everyone', everyone: true },
          channel_access: EMPTY_ACCESS_HOLDER,
        },
      ]);

      const result = await service.listChannelMembers(
        'ch-public',
        'chap-1',
        'user-1',
      );

      expect(result).toEqual([
        {
          user_id: 'plain-member',
          role_rank: 4,
          role_id: 'r-everyone',
          role_name: 'Members',
        },
      ]);
    });

    it('refuses a caller who cannot read the channel, before any roster read', async () => {
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(
        service.listChannelMembers('ch-private', 'chap-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRbac.getChapterMemberAccess).not.toHaveBeenCalled();
    });

    it('answers 404 for a channel outside the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.listChannelMembers('ch-x', 'chap-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // Alumni are read-mostly (spec/behavior/alumni.md): full read access, but
  // writes only in direct conversations and channels whose lists name the
  // Alumni role.
  describe('assertChannelAccess — Alumni posting', () => {
    // The shape the seeder persists (#3722): the Alumni role on who can see,
    // and anyone who can see may post.
    const alumniChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-alumni',
      name: 'alumni',
      type: 'ROLE_GATED',
      who_can_see: [OFFICERS, ALUMNI],
    };

    // FRA-321's shape: a channel alumni can see but whose who-can-post list
    // leaves them out. Seeing it must not make it alumni-postable.
    const execChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-exec',
      name: 'exec-board',
      type: 'ROLE_GATED',
      is_read_only: true,
      who_can_see: [OFFICERS, ALUMNI],
      who_can_post: [OFFICERS],
    };

    const dmChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-dm',
      type: 'DM',
      member_ids: ['user-1', 'user-2'],
    };

    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockRbac.getChannelAccessHolder.mockResolvedValue(ALUMNUS);
    });

    it('lets an alumni member read an operational PUBLIC channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'read'),
      ).resolves.toBe(publicChannel);
    });

    it('denies an alumni member posting in an operational PUBLIC channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies an alumni member replying in a thread in an operational channel (#3785)', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-1', 'chap-1', 'user-1', 'thread'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRbac.getChannelAccessHolder).toHaveBeenCalled();
    });

    it('denies an alumni member posting in a PRIVATE channel they belong to', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...privateChannel,
        member_ids: ['user-1'],
      });

      await expect(
        service.assertChannelAccess('ch-private', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an alumni member to post in the seeded #alumni channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(alumniChannel);

      await expect(
        service.assertChannelAccess('ch-alumni', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(alumniChannel);
    });

    // FRA-321: the vulnerability was a channel alumni could see becoming
    // alumni-postable for that alone. Who can post decides, and it leaves
    // them out here.
    it('denies an alumni member posting where who can post leaves them out', async () => {
      mockChannelRepo.findById.mockResolvedValue(execChannel);

      await expect(
        service.assertChannelAccess('ch-exec', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still lets an alumni member read that channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(execChannel);

      await expect(
        service.assertChannelAccess('ch-exec', 'chap-1', 'user-1', 'read'),
      ).resolves.toBe(execChannel);
    });

    it('allows an alumni member to post in a DM', async () => {
      mockChannelRepo.findById.mockResolvedValue(dmChannel);

      await expect(
        service.assertChannelAccess('ch-dm', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(dmChannel);
    });

    it('does not restrict a President who also carries the Alumni role', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);
      mockRbac.getChannelAccessHolder.mockResolvedValue({
        ...ALUMNUS,
        wildcard: true,
      });

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(publicChannel);
    });

    it('leaves active members unaffected', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(EMPTY_ACCESS_HOLDER);
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(publicChannel);
    });

    it('does not resolve the alumni role on read paths', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await service.assertChannelAccess(
        'ch-public',
        'chap-1',
        'user-1',
        'read',
      );

      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    // Regression guard: without asserting the ARGUMENTS, the lookup can be
    // silently mis-wired (wrong chapter, wrong role ids) so every alumni
    // resolves to "not alumni" — disabling the whole restriction while the
    // suite stays green. Mutation-tested: this is the test that catches it.
    it("resolves the alumni role against the caller's own chapter and roles", async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRbac.getChannelAccessHolder).toHaveBeenCalledWith(
        'chap-1',
        member.role_ids,
      );
    });

    it('skips the alumni lookup for always-postable channel types', async () => {
      mockChannelRepo.findById.mockResolvedValue(dmChannel);

      await service.assertChannelAccess('ch-dm', 'chap-1', 'user-1', 'post');

      // A DM is postable by alumni regardless, so the extra round trip on the
      // chat hot path is not worth paying.
      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    // "vote" is a write, but participating in a poll is not posting.
    it('does not apply the alumni restriction to votes', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'vote'),
      ).resolves.toBe(publicChannel);

      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    it('still enforces who can post on a vote', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);

      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'vote'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // #2311, option 1: the report row as a capability over exactly one message.
  // The grant is the one way past the channel predicate, so every edge of it is
  // pinned here, where the predicate lives.
  describe('assertMessageAccess — reported-message grant', () => {
    const OFFICER = 'user-officer';
    const dmChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-dm',
      name: 'dm-a-b',
      type: 'DM',
      member_ids: ['user-a', 'user-b'],
    };
    const reported = {
      id: 'msg-reported',
      channel_id: 'ch-dm',
      sender_id: 'user-b',
      content: 'reported text',
      is_deleted: false,
    } as ChatMessage;
    const sibling = { ...reported, id: 'msg-sibling', content: 'unreported' };
    const openReport: ChatMessageReportView = {
      id: 'report-1',
      chapter_id: 'chap-1',
      message_id: 'msg-reported',
      channel_id: 'chan-1',
      reported_content: 'reported text',
      reported_sender_id: 'user-b',
      reported_author_name: null,
      reason: 'harassment',
      details: null,
      status: 'open',
      created_at: '2026-01-01T00:00:00.000Z',
      resolved_at: null,
      resolved_by: null,
      reported_attachments: [],
    };
    const grant = () => ReportedMessageGrant.fromOpenReport(openReport);

    beforeEach(() => {
      mockChannelRepo.findById.mockResolvedValue(dmChannel);
      mockMessageRepo.findById.mockImplementation((id: string) =>
        Promise.resolve(
          id === reported.id ? reported : id === sibling.id ? sibling : null,
        ),
      );
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockRbac.getChannelAccessHolder.mockResolvedValue(WILDCARD);
    });

    it('without a grant, a wildcard officer is refused the DM message', async () => {
      // The baseline the grant exists to narrow: `channels:manage` — even `*` —
      // does not reach a direct conversation.
      await expect(
        service.assertMessageAccess('msg-reported', 'chap-1', OFFICER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('with a grant, admits the one message the report names', async () => {
      const message = await service.assertMessageAccess(
        'msg-reported',
        'chap-1',
        OFFICER,
        'read',
        grant(),
      );

      expect(message.id).toBe('msg-reported');
      // The channel still resolves inside the caller's chapter, and the caller
      // is still checked for membership of it.
      expect(mockChannelRepo.findById).toHaveBeenCalledWith('ch-dm', 'chap-1');
      expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        OFFICER,
        'chap-1',
      );
    });

    it('refuses a sibling message in the same DM, before reading it', async () => {
      await expect(
        service.assertMessageAccess(
          'msg-sibling',
          'chap-1',
          OFFICER,
          'read',
          grant(),
        ),
      ).rejects.toThrow(ForbiddenException);
      // Decided from the grant alone: a grant pointed elsewhere cannot even
      // learn whether that message id exists.
      expect(mockMessageRepo.findById).not.toHaveBeenCalled();
    });

    it('never authorizes a post — a report grants removal, not authorship', async () => {
      await expect(
        service.assertMessageAccess(
          'msg-reported',
          'chap-1',
          OFFICER,
          'post',
          grant(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a grant from another chapter', async () => {
      await expect(
        service.assertMessageAccess(
          'msg-reported',
          'chap-other',
          OFFICER,
          'read',
          grant(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('normalizes a channel outside the chapter to the same 404', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.assertMessageAccess(
          'msg-reported',
          'chap-1',
          OFFICER,
          'read',
          grant(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a caller who is not a member of the chapter', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.assertMessageAccess(
          'msg-reported',
          'chap-1',
          OFFICER,
          'read',
          grant(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not widen channel reads: the DM itself stays closed', async () => {
      // `assertChannelAccess` takes no grant at all, so every thread read
      // (`getMessages`, pins, the channel row) is decided exactly as before.
      await expect(
        service.assertChannelAccess('ch-dm', 'chap-1', OFFICER),
      ).rejects.toThrow(ForbiddenException);
    });

    describe('ReportedMessageGrant.fromOpenReport', () => {
      it.each(['reviewed', 'actioned', 'dismissed'] as const)(
        'refuses a %s report',
        (status) => {
          expect(() =>
            ReportedMessageGrant.fromOpenReport({ ...openReport, status }),
          ).toThrow(ConflictException);
        },
      );

      it('refuses a report whose message was hard-deleted', () => {
        expect(() =>
          ReportedMessageGrant.fromOpenReport({
            ...openReport,
            message_id: null,
          }),
        ).toThrow(ConflictException);
      });

      it('names the report, its chapter and its message', () => {
        expect(grant()).toMatchObject({
          reportId: 'report-1',
          chapterId: 'chap-1',
          messageId: 'msg-reported',
        });
      });
    });
  });

  describe('filterAccessibleChannelIds', () => {
    it('returns an empty set for an empty candidate list without hitting repos', async () => {
      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        [],
      );

      expect(result.size).toBe(0);
      expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      expect(mockChannelRepo.findByIds).not.toHaveBeenCalled();
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('returns an empty set when the caller is not a chapter member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'ghost',
        ['ch-public'],
      );

      expect(result.size).toBe(0);
      expect(mockChannelRepo.findByIds).not.toHaveBeenCalled();
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('keeps only the channels the caller can read', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockChannelRepo.findByIds.mockResolvedValue([
        publicChannel,
        privateChannel,
        { ...publicChannel, id: 'ch-other' },
      ]);

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        ['ch-public', 'ch-private'],
      );

      expect([...result].sort()).toEqual(['ch-public']);
      expect(mockChannelRepo.findByIds).toHaveBeenCalledTimes(1);
      expect(mockChannelRepo.findByIds).toHaveBeenCalledWith('chap-1', [
        'ch-public',
        'ch-private',
      ]);
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
      // No candidate with a who-can-see list → no role lookup.
      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    it('loads roles once when a channel with a who-can-see list is among the candidates', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockChannelRepo.findByIds.mockResolvedValue([
        publicChannel,
        roleGatedChannel,
      ]);
      mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(SECRET));

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        ['ch-public', 'ch-role'],
      );

      expect([...result].sort()).toEqual(['ch-public', 'ch-role']);
      expect(mockChannelRepo.findByIds).toHaveBeenCalledTimes(1);
      expect(mockChannelRepo.findByIds).toHaveBeenCalledWith('chap-1', [
        'ch-public',
        'ch-role',
      ]);
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
      expect(mockRbac.getChannelAccessHolder).toHaveBeenCalledTimes(1);
    });

    it('drops a wanted id the repository does not return for this chapter', async () => {
      // The chapter-scoped batch is load-bearing: `applyReadPredicate` treats
      // membership in `chap-1` as `isChapterMember` for every returned row. A
      // foreign PUBLIC channel must never come back from `findByIds`.
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockChannelRepo.findByIds.mockResolvedValue([publicChannel]);

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        ['ch-public', 'ch-foreign'],
      );

      expect([...result]).toEqual(['ch-public']);
      expect(mockChannelRepo.findByIds).toHaveBeenCalledWith('chap-1', [
        'ch-public',
        'ch-foreign',
      ]);
    });

    it('drops an archived Group DM from the active list by default', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      const archivedGroupDm: ChatChannel = {
        ...publicChannel,
        id: 'ch-archived',
        type: 'GROUP_DM',
        member_ids: ['user-1'],
        archived_at: '2026-01-02T00:00:00.000Z',
      };
      mockChannelRepo.findByIds.mockResolvedValue([
        publicChannel,
        archivedGroupDm,
      ]);

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        ['ch-public', 'ch-archived'],
      );

      expect([...result]).toEqual(['ch-public']);
    });

    it('keeps an archived Group DM when includeArchived is set', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      const archivedGroupDm: ChatChannel = {
        ...publicChannel,
        id: 'ch-archived',
        type: 'GROUP_DM',
        member_ids: ['user-1'],
        archived_at: '2026-01-02T00:00:00.000Z',
      };
      mockChannelRepo.findByIds.mockResolvedValue([
        publicChannel,
        archivedGroupDm,
      ]);

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        ['ch-public', 'ch-archived'],
        { includeArchived: true },
      );

      expect([...result].sort()).toEqual(['ch-archived', 'ch-public']);
    });
  });

  // The array-taking half, for callers that already hold the rows. Its whole
  // reason to exist is that it must not re-read the chapter's channels.
  describe('filterAccessibleChannels', () => {
    it('returns nothing for an empty array without hitting repos', async () => {
      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [],
      );

      expect(result).toEqual([]);
      expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('returns nothing when the caller is not a chapter member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      const result = await service.filterAccessibleChannels('chap-1', 'ghost', [
        publicChannel,
      ]);

      expect(result).toEqual([]);
    });

    it('keeps only readable channels from the array it was given', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [publicChannel, privateChannel],
      );

      expect(result.map((channel) => channel.id)).toEqual(['ch-public']);
      // The point of the method: the rows came from the caller, so the
      // chapter's channel list is never re-read.
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('drops rows belonging to another chapter', async () => {
      // The caller's membership proves the *caller* is in `chap-1`; it says
      // nothing about the rows. Without the re-scope a foreign PUBLIC channel
      // would satisfy the predicate on `isChapterMember: true`.
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [
          publicChannel,
          { ...publicChannel, id: 'ch-foreign', chapter_id: 'chap-2' },
        ],
      );

      expect(result.map((channel) => channel.id)).toEqual(['ch-public']);
    });

    // #348: an archived Group DM (membership dropped to <= 1 via leave) drops
    // out of the active list, even though the caller would otherwise still
    // pass `canAccessChannel` for it.
    it('drops an archived channel from the active list', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      const archivedGroupDm: ChatChannel = {
        ...publicChannel,
        id: 'ch-archived',
        type: 'GROUP_DM',
        member_ids: ['user-1'],
        archived_at: '2026-01-02T00:00:00.000Z',
      };

      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [publicChannel, archivedGroupDm],
      );

      expect(result.map((channel) => channel.id)).toEqual(['ch-public']);
    });

    it('returns nothing without a membership lookup when every row is foreign', async () => {
      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [{ ...publicChannel, id: 'ch-foreign', chapter_id: 'chap-2' }],
      );

      expect(result).toEqual([]);
      expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('resolves roles once for a candidate with a who-can-see list', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(SECRET));

      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [publicChannel, roleGatedChannel],
      );

      expect(result.map((channel) => channel.id).sort()).toEqual([
        'ch-public',
        'ch-role',
      ]);
      expect(mockRbac.getChannelAccessHolder).toHaveBeenCalledTimes(1);
    });
  });

  // #704: the capability projection the client's composer state is derived
  // from — must not drift from what `assertChannelAccess` actually enforces.
  describe('withPostCapability', () => {
    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
    });

    it('returns nothing for an empty input without hitting rbac', async () => {
      const result = await service.withPostCapability('chap-1', 'user-1', []);

      expect(result).toEqual([]);
      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    it('marks an ordinary PUBLIC channel postable for an active member', async () => {
      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
      ]);

      expect(result).toEqual({ ...publicChannel, can_post: true });
    });

    it('marks a channel not-postable off its who-can-post list', async () => {
      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        readOnlyChannel,
      ]);

      expect(result?.can_post).toBe(false);
    });

    it('marks it postable on the list', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(holderOf(OFFICERS));

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        readOnlyChannel,
      ]);

      expect(result?.can_post).toBe(true);
    });

    it('marks an operational channel not-postable for an alumni member, without leaking the raw flag', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(ALUMNUS);

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
      ]);

      expect(result).toEqual({ ...publicChannel, can_post: false });
      expect(Object.keys(result ?? {})).not.toContain('alumniEntries');
    });

    it('marks a channel whose lists name the Alumni role postable for an alumni member', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue(ALUMNUS);
      const alumniChannel: ChatChannel = {
        ...publicChannel,
        id: 'ch-alumni',
        type: 'ROLE_GATED',
        who_can_see: [OFFICERS, ALUMNI],
      };

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        alumniChannel,
      ]);

      expect(result?.can_post).toBe(true);
    });

    it('does not restrict a President who also carries the Alumni role', async () => {
      mockRbac.getChannelAccessHolder.mockResolvedValue({
        ...ALUMNUS,
        wildcard: true,
      });

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
      ]);

      expect(result?.can_post).toBe(true);
    });

    it('skips the role lookup when every candidate is a DM', async () => {
      const dmChannel: ChatChannel = {
        ...publicChannel,
        id: 'ch-dm',
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };

      await service.withPostCapability('chap-1', 'user-1', [dmChannel]);

      expect(mockRbac.getChannelAccessHolder).not.toHaveBeenCalled();
    });

    it('annotates a mixed batch independently per channel, from one lookup', async () => {
      const result = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
        readOnlyChannel,
      ]);

      expect(result.map((c) => c.can_post)).toEqual([true, false]);
      expect(mockRbac.getChannelAccessHolder).toHaveBeenCalledTimes(1);
    });
  });
});
