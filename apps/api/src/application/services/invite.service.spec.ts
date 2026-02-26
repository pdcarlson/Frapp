jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InviteService } from './invite.service';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '../../domain/repositories/invite.repository.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import type { Invite } from '../../domain/entities/invite.entity';
import type { Chapter } from '../../domain/entities/chapter.entity';
import type { Role } from '../../domain/entities/role.entity';
import type { Member } from '../../domain/entities/member.entity';

describe('InviteService', () => {
  let service: InviteService;
  let mockInviteRepo: jest.Mocked<IInviteRepository>;
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;

  beforeEach(async () => {
    mockInviteRepo = {
      findByToken: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      markUsed: jest.fn(),
      markUsedAtomically: jest.fn(),
    };

    mockChapterRepo = {
      findById: jest.fn(),
      findByStripeCustomerId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: INVITE_REPOSITORY, useValue: mockInviteRepo },
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
      ],
    }).compile();

    service = module.get(InviteService);
  });

  it('should create invite with 24h expiry', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
    };
    mockChapterRepo.findById.mockResolvedValue(chapter);
    mockInviteRepo.create.mockImplementation((data) =>
      Promise.resolve({
        id: 'inv-1',
        token: data.token!,
        chapter_id: data.chapter_id!,
        role: data.role!,
        expires_at: data.expires_at!,
        created_by: data.created_by!,
        used_at: null,
        created_at: '2024-01-01',
      }),
    );

    const result = await service.create('ch-1', 'user-1', 'Member');

    expect(mockChapterRepo.findById).toHaveBeenCalledWith('ch-1');
    expect(mockInviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'test-uuid',
        chapter_id: 'ch-1',
        role: 'Member',
        created_by: 'user-1',
      }),
    );
    const createCall = mockInviteRepo.create.mock.calls[0][0];
    const expiresAt = new Date(createCall.expires_at);
    const now = new Date();
    expect(expiresAt.getTime()).toBeGreaterThan(now.getTime());
    expect(expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000 + 5000,
    );
    expect(result.token).toBe('test-uuid');
  });

  it('should reject create when subscription not active', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'incomplete',
      subscription_id: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.findById.mockResolvedValue(chapter);

    const promise = service.create('ch-1', 'user-1', 'Member');
    await expect(promise).rejects.toThrow(HttpException);
    await expect(promise).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
      message: 'Chapter subscription is not active',
    });
    expect(mockInviteRepo.create).not.toHaveBeenCalled();
  });

  it('should create batch invites', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.findById.mockResolvedValue(chapter);
    let inviteCount = 0;
    mockInviteRepo.create.mockImplementation((data) =>
      Promise.resolve({
        id: `inv-${++inviteCount}`,
        token: data.token!,
        chapter_id: data.chapter_id!,
        role: data.role!,
        expires_at: data.expires_at!,
        created_by: data.created_by!,
        used_at: null,
        created_at: '2024-01-01',
      }),
    );

    const result = await service.createBatch('ch-1', 'user-1', 'Member', 3);

    expect(mockInviteRepo.create).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
  });

  it('should redeem valid invite', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
    };
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    const member: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
    mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
    mockMemberRepo.create.mockResolvedValue(member);

    const result = await service.redeem('test-uuid', 'user-2');

    expect(mockInviteRepo.findByToken).toHaveBeenCalledWith('test-uuid');
    expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith('user-2', 'ch-1');
    expect(mockInviteRepo.markUsedAtomically).toHaveBeenCalledWith('inv-1');
    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
    });
    expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
  });

  it('should fall back to Member role when invite role not found', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'NonExistentRole',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
    };
    const memberRole: Role = {
      id: 'role-member',
      chapter_id: 'ch-1',
      name: 'Member',
      permissions: [],
      is_system: true,
      display_order: 3,
      color: null,
      created_at: '2024-01-01',
    };
    const member: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
      has_completed_onboarding: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
    mockInviteRepo.markUsedAtomically.mockResolvedValue(true);
    mockRoleRepo.findByChapter.mockResolvedValue([memberRole]);
    mockMemberRepo.create.mockResolvedValue(member);

    const result = await service.redeem('test-uuid', 'user-2');

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: [memberRole.id],
    });
    expect(result).toEqual({ chapterId: 'ch-1', memberId: 'member-1' });
  });

  it('should reject expired invite', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite expired');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should reject used invite', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: '2024-01-02',
      created_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(GoneException);
    await expect(promise).rejects.toThrow('Invite already used');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should reject if user already member', async () => {
    const invite: Invite = {
      id: 'inv-1',
      token: 'test-uuid',
      chapter_id: 'ch-1',
      role: 'Member',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: 'user-1',
      used_at: null,
      created_at: '2024-01-01',
    };
    const existingMember: Member = {
      id: 'member-1',
      user_id: 'user-2',
      chapter_id: 'ch-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockInviteRepo.findByToken.mockResolvedValue(invite);
    mockMemberRepo.findByUserAndChapter.mockResolvedValue(existingMember);

    const promise = service.redeem('test-uuid', 'user-2');
    await expect(promise).rejects.toThrow(ConflictException);
    await expect(promise).rejects.toThrow('Already a member of this chapter');
    expect(mockInviteRepo.markUsedAtomically).not.toHaveBeenCalled();
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('should list invites by chapter', async () => {
    const invites: Invite[] = [
      {
        id: 'inv-1',
        token: 'token-1',
        chapter_id: 'ch-1',
        role: 'Member',
        expires_at: '2024-01-02',
        created_by: 'user-1',
        used_at: null,
        created_at: '2024-01-01',
      },
    ];
    mockInviteRepo.findByChapter.mockResolvedValue(invites);

    const result = await service.findByChapter('ch-1');

    expect(mockInviteRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    expect(result).toEqual(invites);
  });
});
