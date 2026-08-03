import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelAccessService } from './channel-access.service';
import { RbacService } from './rbac.service';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '../../domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { ChatChannel } from '../../domain/entities/chat.entity';
import type { Member } from '../../domain/entities/member.entity';

describe('ChannelAccessService', () => {
  let service: ChannelAccessService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRbac: {
    getEffectivePermissions: jest.Mock;
    hasAlumniRole: jest.Mock;
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

  const member = { id: 'm-1' } as Member;

  beforeEach(async () => {
    mockChannelRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findDm: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
  });

  // Alumni are read-mostly (spec/behavior/alumni.md): full read access, but
  // writes only in the ROLE_GATED #alumni channel and direct conversations.
  describe('assertChannelAccess — Alumni posting', () => {
    const alumniChannel: ChatChannel = {
      ...publicChannel,
      id: 'ch-alumni',
      name: 'alumni',
      type: 'ROLE_GATED',
      required_permissions: null,
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
});
