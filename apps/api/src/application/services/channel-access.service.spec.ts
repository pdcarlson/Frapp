import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelAccessService } from './channel-access.service';
import { RbacService } from './rbac.service';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '../../domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { ChatChannel } from '../../domain/entities/chat.entity';

describe('ChannelAccessService', () => {
  let service: ChannelAccessService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRbac: {
    getEffectivePermissions: jest.Mock;
    hasAlumniRole: jest.Mock;
    isAlumni: jest.Mock;
  };

  const publicChannel: ChatChannel = {
    id: 'ch-public',
    chapter_id: 'chap-1',
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
    required_permissions: ['secret:view'],
  };

  const readOnlyChannel: ChatChannel = {
    ...publicChannel,
    id: 'ch-announce',
    is_read_only: true,
  };

  // Carries real role_ids: the alumni lookup is fed from this row, and a test
  // that leaves them undefined cannot tell a correct call from a garbage one.
  const member = { id: 'm-1', role_ids: ['role-alumni'] };

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
    mockMemberRepo = {
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    mockRbac = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
      // Default to an active (non-alumni) member.
      hasAlumniRole: jest.fn().mockResolvedValue(false),
      isAlumni: jest.fn().mockResolvedValue(false),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelAccessService,
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
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
      // PUBLIC read needs no permission lookup.
      expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
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

    it('gates a ROLE_GATED channel on effective permissions', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      mockRbac.getEffectivePermissions.mockResolvedValueOnce(['secret:view']);
      await expect(
        service.assertChannelAccess('ch-role', 'chap-1', 'user-1'),
      ).resolves.toBe(roleGatedChannel);

      mockRbac.getEffectivePermissions.mockResolvedValueOnce([]);
      await expect(
        service.assertChannelAccess('ch-role', 'chap-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('gates posting to a read-only channel behind announcements:post', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      // Read is fine for any member.
      mockRbac.getEffectivePermissions.mockResolvedValue([]);
      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'read'),
      ).resolves.toBe(readOnlyChannel);

      // Post is denied without the permission...
      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);

      // ...and allowed with it.
      mockRbac.getEffectivePermissions.mockResolvedValue([
        'announcements:post',
      ]);
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

  // Alumni are read-mostly (spec/behavior/alumni.md): full read access, but
  // writes only in direct conversations and ROLE_GATED channels that require
  // `alumni:post`.
  describe('assertChannelAccess — Alumni posting', () => {
    // The shape the seeder actually persists (FRA-321). It used to be
    // `required_permissions: null`, which is now denied outright.
    const alumniChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-alumni',
      name: 'alumni',
      type: 'ROLE_GATED',
      required_permissions: ['members:view', 'alumni:post'],
    };

    // A chapter's own role-gated channel: gated, but not an alumni space.
    const execChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-exec',
      name: 'exec-board',
      type: 'ROLE_GATED',
      required_permissions: ['members:view'],
    };

    const dmChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-dm',
      type: 'DM',
      member_ids: ['user-1', 'user-2'],
    };

    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockRbac.hasAlumniRole.mockResolvedValue(true);
      // The Alumni role's seeded permission set.
      mockRbac.getEffectivePermissions.mockResolvedValue([
        'members:view',
        'alumni:post',
      ]);
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

    it('denies an alumni member posting in a PRIVATE channel they belong to', async () => {
      mockChannelRepo.findById.mockResolvedValue({
        ...privateChannel,
        member_ids: ['user-1'],
      });

      await expect(
        service.assertChannelAccess('ch-private', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an alumni member to post in the ROLE_GATED #alumni channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(alumniChannel);

      await expect(
        service.assertChannelAccess('ch-alumni', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(alumniChannel);
    });

    // FRA-321: the vulnerability. The post gate keyed on channel *type*, so a
    // chapter's #exec-board was alumni-postable purely for being ROLE_GATED —
    // and gating it on members:view (the Alumni role's own permission) did not
    // help. It is now denied because it does not require alumni:post.
    it('denies an alumni member posting in a ROLE_GATED channel that is not an alumni space', async () => {
      mockChannelRepo.findById.mockResolvedValue(execChannel);

      await expect(
        service.assertChannelAccess('ch-exec', 'chap-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still lets an alumni member read that ROLE_GATED channel', async () => {
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
      mockRbac.getEffectivePermissions.mockResolvedValue(['*']);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'post'),
      ).resolves.toBe(publicChannel);
    });

    it('leaves active members unaffected', async () => {
      mockRbac.hasAlumniRole.mockResolvedValue(false);
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

      expect(mockRbac.hasAlumniRole).not.toHaveBeenCalled();
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

      expect(mockRbac.hasAlumniRole).toHaveBeenCalledWith(
        'chap-1',
        member.role_ids,
      );
    });

    it('skips the alumni lookup for always-postable channel types', async () => {
      mockChannelRepo.findById.mockResolvedValue(dmChannel);

      await service.assertChannelAccess('ch-dm', 'chap-1', 'user-1', 'post');

      // A DM is postable by alumni regardless, so the extra round trip on the
      // chat hot path is not worth paying.
      expect(mockRbac.hasAlumniRole).not.toHaveBeenCalled();
    });

    // "vote" is a write, but participating in a poll is not posting.
    it('does not apply the alumni restriction to votes', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertChannelAccess('ch-public', 'chap-1', 'user-1', 'vote'),
      ).resolves.toBe(publicChannel);

      expect(mockRbac.hasAlumniRole).not.toHaveBeenCalled();
    });

    it('still enforces the read-only gate on a vote', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);
      mockRbac.getEffectivePermissions.mockResolvedValue([]);

      await expect(
        service.assertChannelAccess('ch-announce', 'chap-1', 'user-1', 'vote'),
      ).rejects.toThrow(ForbiddenException);
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
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('keeps only the channels the caller can read', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockChannelRepo.findByChapter.mockResolvedValue([
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
      // No ROLE_GATED candidate → no permission lookup.
      expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('loads permissions once when a ROLE_GATED channel is among the candidates', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockChannelRepo.findByChapter.mockResolvedValue([
        publicChannel,
        roleGatedChannel,
      ]);
      mockRbac.getEffectivePermissions.mockResolvedValue(['secret:view']);

      const result = await service.filterAccessibleChannelIds(
        'chap-1',
        'user-1',
        ['ch-public', 'ch-role'],
      );

      expect([...result].sort()).toEqual(['ch-public', 'ch-role']);
      expect(mockRbac.getEffectivePermissions).toHaveBeenCalledTimes(1);
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

    it('resolves permissions once for a ROLE_GATED candidate', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);
      mockRbac.getEffectivePermissions.mockResolvedValue(['secret:view']);

      const result = await service.filterAccessibleChannels(
        'chap-1',
        'user-1',
        [publicChannel, roleGatedChannel],
      );

      expect(result.map((channel) => channel.id).sort()).toEqual([
        'ch-public',
        'ch-role',
      ]);
      expect(mockRbac.getEffectivePermissions).toHaveBeenCalledTimes(1);
    });
  });

  // #704: the capability projection the client's composer state is derived
  // from — must not drift from what `assertChannelAccess` actually enforces.
  describe('withPostCapability', () => {
    it('returns nothing for an empty input without hitting rbac', async () => {
      const result = await service.withPostCapability('chap-1', 'user-1', []);

      expect(result).toEqual([]);
      expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
      expect(mockRbac.isAlumni).not.toHaveBeenCalled();
    });

    it('marks an ordinary PUBLIC channel postable for an active member', async () => {
      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
      ]);

      expect(result).toEqual({ ...publicChannel, can_post: true });
    });

    it('marks a read-only channel not-postable without announcements:post', async () => {
      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        readOnlyChannel,
      ]);

      expect(result?.can_post).toBe(false);
    });

    it('marks a read-only channel postable with announcements:post', async () => {
      mockRbac.getEffectivePermissions.mockResolvedValue([
        'announcements:post',
      ]);

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        readOnlyChannel,
      ]);

      expect(result?.can_post).toBe(true);
    });

    it('marks an operational channel not-postable for an alumni member, without leaking the raw flag', async () => {
      mockRbac.isAlumni.mockResolvedValue(true);

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
      ]);

      expect(result).toEqual({ ...publicChannel, can_post: false });
      expect(Object.keys(result ?? {})).not.toContain('isAlumni');
    });

    it('marks the alumni-postable ROLE_GATED channel postable for an alumni member', async () => {
      mockRbac.isAlumni.mockResolvedValue(true);
      mockRbac.getEffectivePermissions.mockResolvedValue([
        'members:view',
        'alumni:post',
      ]);
      const alumniChannel: ChatChannel = {
        ...publicChannel,
        id: 'ch-alumni',
        type: 'ROLE_GATED',
        required_permissions: ['members:view', 'alumni:post'],
      };

      const [result] = await service.withPostCapability('chap-1', 'user-1', [
        alumniChannel,
      ]);

      expect(result?.can_post).toBe(true);
    });

    it('skips the alumni lookup when every candidate is alumni-postable by type', async () => {
      const dmChannel: ChatChannel = {
        ...publicChannel,
        id: 'ch-dm',
        type: 'DM',
        member_ids: ['user-1', 'user-2'],
      };

      await service.withPostCapability('chap-1', 'user-1', [dmChannel]);

      expect(mockRbac.isAlumni).not.toHaveBeenCalled();
    });

    it('annotates a mixed batch independently per channel', async () => {
      mockRbac.getEffectivePermissions.mockResolvedValue([]);

      const result = await service.withPostCapability('chap-1', 'user-1', [
        publicChannel,
        readOnlyChannel,
      ]);

      expect(result.map((c) => c.can_post)).toEqual([true, false]);
    });
  });
});
