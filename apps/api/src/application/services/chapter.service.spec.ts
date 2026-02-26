import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChapterService } from './chapter.service';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
} from '../../domain/constants/permissions';
import type { Chapter } from '../../domain/entities/chapter.entity';
import type { Role } from '../../domain/entities/role.entity';
import type { Member } from '../../domain/entities/member.entity';

describe('ChapterService', () => {
  let service: ChapterService;
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockSupabase: { from: jest.Mock };

  beforeEach(async () => {
    mockChapterRepo = {
      findById: jest.fn(),
      findByStripeCustomerId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const mockInsert = jest.fn().mockResolvedValue({});
    mockSupabase = {
      from: jest.fn().mockReturnValue({ insert: mockInsert }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get(ChapterService);
  });

  it('should find chapter by id', async () => {
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

    const result = await service.findById('ch-1');

    expect(mockChapterRepo.findById).toHaveBeenCalledWith('ch-1');
    expect(result).toEqual(chapter);
  });

  it('should throw NotFoundException when chapter not found', async () => {
    mockChapterRepo.findById.mockResolvedValue(null);

    await expect(service.findById('ch-1')).rejects.toThrow(NotFoundException);
    await expect(service.findById('ch-1')).rejects.toThrow('Chapter not found');
  });

  it('should create chapter with default roles', async () => {
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
    mockChapterRepo.create.mockResolvedValue(chapter);

    const roles: Role[] = DEFAULT_SYSTEM_ROLES.map((r, i) => ({
      id: `role-${i}`,
      chapter_id: chapter.id,
      name: r.name,
      permissions: [...r.permissions],
      is_system: r.is_system,
      display_order: r.display_order,
      color: r.color ?? null,
      created_at: '2024-01-01',
    }));

    mockRoleRepo.create
      .mockResolvedValueOnce(roles[0])
      .mockResolvedValueOnce(roles[1])
      .mockResolvedValueOnce(roles[2])
      .mockResolvedValueOnce(roles[3])
      .mockResolvedValueOnce(roles[4]);

    const result = await service.create('user-1', {
      name: 'Alpha',
      university: 'State U',
    });

    expect(mockChapterRepo.create).toHaveBeenCalledWith({
      name: 'Alpha',
      university: 'State U',
    });
    expect(mockRoleRepo.create).toHaveBeenCalledTimes(5);
    expect(result).toEqual(chapter);
  });

  it('should assign creator as President on chapter creation', async () => {
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
    mockChapterRepo.create.mockResolvedValue(chapter);

    const presidentRole: Role = {
      id: 'role-president',
      chapter_id: chapter.id,
      name: 'President',
      permissions: ['*'],
      is_system: true,
      display_order: 1,
      color: '#FFD700',
      created_at: '2024-01-01',
    };

    const otherRoles: Role[] = DEFAULT_SYSTEM_ROLES.slice(1).map((r, i) => ({
      id: `role-${i}`,
      chapter_id: chapter.id,
      name: r.name,
      permissions: [...r.permissions],
      is_system: r.is_system,
      display_order: r.display_order,
      color: r.color ?? null,
      created_at: '2024-01-01',
    }));

    mockRoleRepo.create
      .mockResolvedValueOnce(presidentRole)
      .mockResolvedValueOnce(otherRoles[0])
      .mockResolvedValueOnce(otherRoles[1])
      .mockResolvedValueOnce(otherRoles[2])
      .mockResolvedValueOnce(otherRoles[3]);

    const member: Member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [presidentRole.id],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockMemberRepo.create.mockResolvedValue(member);

    await service.create('user-1', { name: 'Alpha', university: 'State U' });

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [presidentRole.id],
      has_completed_onboarding: true,
    });
  });

  it('should create default channels on chapter creation', async () => {
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
    mockChapterRepo.create.mockResolvedValue(chapter);

    const roles: Role[] = DEFAULT_SYSTEM_ROLES.map((r, i) => ({
      id: `role-${i}`,
      chapter_id: chapter.id,
      name: r.name,
      permissions: [...r.permissions],
      is_system: r.is_system,
      display_order: r.display_order,
      color: r.color ?? null,
      created_at: '2024-01-01',
    }));
    mockRoleRepo.create.mockImplementation((data) =>
      Promise.resolve({
        id: `role-${roles.length}`,
        chapter_id: data.chapter_id!,
        name: data.name!,
        permissions: data.permissions ?? [],
        is_system: data.is_system ?? false,
        display_order: data.display_order ?? 0,
        color: data.color ?? null,
        created_at: '2024-01-01',
      }),
    );
    mockMemberRepo.create.mockResolvedValue({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: ['role-0'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.create('user-1', { name: 'Alpha', university: 'State U' });

    expect(mockSupabase.from).toHaveBeenCalledWith('chat_channels');
    expect(mockSupabase.from().insert).toHaveBeenCalledTimes(3);
    for (const channelDef of DEFAULT_CHANNELS) {
      expect(mockSupabase.from().insert).toHaveBeenCalledWith({
        chapter_id: chapter.id,
        name: channelDef.name,
        type: channelDef.type,
        is_read_only: channelDef.is_read_only,
      });
    }
  });

  it('should update chapter data', async () => {
    const updatedChapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha Updated',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      accent_color: '#FF0000',
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockChapterRepo.update.mockResolvedValue(updatedChapter);

    const result = await service.update('ch-1', {
      name: 'Alpha Updated',
      accent_color: '#FF0000',
    });

    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      name: 'Alpha Updated',
      accent_color: '#FF0000',
    });
    expect(result).toEqual(updatedChapter);
  });
});
