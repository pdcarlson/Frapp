import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ChannelAccessService } from './channel-access.service';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '../../domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { RbacService } from './rbac.service';
import type { ChatChannel } from '../../domain/entities/chat.entity';

describe('ChannelAccessService', () => {
  let service: ChannelAccessService;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockMemberRepo: { findByUserAndChapter: jest.Mock };
  let mockRbac: { getEffectivePermissions: jest.Mock };

  const member = {
    id: 'mem-1',
    user_id: 'user-1',
    chapter_id: 'ch-1',
    role_ids: ['role-1'],
    has_completed_onboarding: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const publicChannel: ChatChannel = {
    id: 'chan-public',
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

  const privateChannel: ChatChannel = {
    ...publicChannel,
    id: 'chan-private',
    name: 'exec',
    type: 'PRIVATE',
    member_ids: ['user-2'],
  };

  const roleGatedChannel: ChatChannel = {
    ...publicChannel,
    id: 'chan-alumni',
    name: 'alumni',
    type: 'ROLE_GATED',
    required_permissions: ['alumni:view'],
  };

  const readOnlyChannel: ChatChannel = {
    ...publicChannel,
    id: 'chan-announce',
    name: 'announcements',
    is_read_only: true,
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
    mockMemberRepo = {
      findByUserAndChapter: jest.fn().mockResolvedValue(member),
    };
    mockRbac = { getEffectivePermissions: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelAccessService,
        { provide: CHAT_CHANNEL_REPOSITORY, useValue: mockChannelRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: RbacService, useValue: mockRbac },
      ],
    }).compile();

    service = module.get(ChannelAccessService);
  });

  describe('assertAccess', () => {
    it('throws NotFound when the channel does not resolve in the chapter', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.assertAccess('chan-x', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws Forbidden when the caller is not a chapter member', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.assertAccess('chan-public', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the channel for a chapter member on a PUBLIC channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(publicChannel);

      await expect(
        service.assertAccess('chan-public', 'ch-1', 'user-1'),
      ).resolves.toBe(publicChannel);
      // No RBAC round-trip for a plain PUBLIC read.
      expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('denies a non-participant of a PRIVATE channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(
        service.assertAccess('chan-private', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a participant of a PRIVATE channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(
        service.assertAccess('chan-private', 'ch-1', 'user-2'),
      ).resolves.toBe(privateChannel);
    });

    it('loads permissions for ROLE_GATED and allows when the caller holds one', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);
      mockRbac.getEffectivePermissions.mockResolvedValue(['alumni:view']);

      await expect(
        service.assertAccess('chan-alumni', 'ch-1', 'user-1'),
      ).resolves.toBe(roleGatedChannel);
      expect(mockRbac.getEffectivePermissions).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
    });

    it('denies ROLE_GATED when the caller lacks the permission', async () => {
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);
      mockRbac.getEffectivePermissions.mockResolvedValue(['events:create']);

      await expect(
        service.assertAccess('chan-alumni', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies a post to a read-only channel without announcements:post', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);

      await expect(
        service.assertAccess('chan-announce', 'ch-1', 'user-1', 'post'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a post to a read-only channel with announcements:post', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);
      mockRbac.getEffectivePermissions.mockResolvedValue([
        'announcements:post',
      ]);

      await expect(
        service.assertAccess('chan-announce', 'ch-1', 'user-1', 'post'),
      ).resolves.toBe(readOnlyChannel);
    });

    it('allows reading a read-only channel without any special permission', async () => {
      mockChannelRepo.findById.mockResolvedValue(readOnlyChannel);

      await expect(
        service.assertAccess('chan-announce', 'ch-1', 'user-1', 'read'),
      ).resolves.toBe(readOnlyChannel);
      expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
    });
  });

  describe('filterAccessibleChannelIds', () => {
    it('returns an empty set for an empty input (no lookups)', async () => {
      const result = await service.filterAccessibleChannelIds(
        'ch-1',
        'user-1',
        [],
      );

      expect(result.size).toBe(0);
      expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('returns an empty set for a non-member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      const result = await service.filterAccessibleChannelIds(
        'ch-1',
        'user-1',
        ['chan-public'],
      );

      expect(result.size).toBe(0);
      expect(mockChannelRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('keeps only channels the caller can read', async () => {
      mockChannelRepo.findByChapter.mockResolvedValue([
        publicChannel,
        privateChannel,
      ]);

      const result = await service.filterAccessibleChannelIds(
        'ch-1',
        'user-1',
        ['chan-public', 'chan-private'],
      );

      expect([...result]).toEqual(['chan-public']);
      // No ROLE_GATED / read-only-post candidate → no RBAC round-trip.
      expect(mockRbac.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('loads effective permissions once when a ROLE_GATED candidate is present', async () => {
      mockChannelRepo.findByChapter.mockResolvedValue([
        publicChannel,
        roleGatedChannel,
      ]);
      mockRbac.getEffectivePermissions.mockResolvedValue(['alumni:view']);

      const result = await service.filterAccessibleChannelIds(
        'ch-1',
        'user-1',
        ['chan-public', 'chan-alumni'],
      );

      expect(new Set(result)).toEqual(new Set(['chan-public', 'chan-alumni']));
      expect(mockRbac.getEffectivePermissions).toHaveBeenCalledTimes(1);
    });
  });
});
