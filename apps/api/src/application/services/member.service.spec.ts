import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { MemberService } from './member.service';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';

describe('MemberService', () => {
  let service: MemberService;
  let mockRepo: jest.Mocked<IMemberRepository>;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: MEMBER_REPOSITORY, useValue: mockRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('should list members by chapter', async () => {
    const members = [
      {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    ];
    mockRepo.findByChapter.mockResolvedValue(members);

    const result = await service.findByChapter('chapter-1');

    expect(mockRepo.findByChapter).toHaveBeenCalledWith('chapter-1');
    expect(result).toEqual(members);
  });

  it('should find member by user and chapter', async () => {
    const member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockRepo.findByUserAndChapter.mockResolvedValue(member);

    const result = await service.findByUserAndChapter('user-1', 'chapter-1');

    expect(mockRepo.findByUserAndChapter).toHaveBeenCalledWith(
      'user-1',
      'chapter-1',
    );
    expect(result).toEqual(member);
  });

  it('should throw NotFoundException when member not found', async () => {
    mockRepo.findByUserAndChapter.mockResolvedValue(null);

    await expect(
      service.findByUserAndChapter('user-1', 'chapter-1'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.findByUserAndChapter('user-1', 'chapter-1'),
    ).rejects.toThrow('Member not found');
  });

  it('should update member roles', async () => {
    const updatedMember = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1', 'role-2'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockRepo.update.mockResolvedValue(updatedMember);

    const result = await service.updateRoles('member-1', ['role-1', 'role-2']);

    expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
      role_ids: ['role-1', 'role-2'],
    });
    expect(result).toEqual(updatedMember);
  });

  it('should update onboarding status', async () => {
    const updatedMember = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: 'chapter-1',
      role_ids: ['role-1'],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockRepo.update.mockResolvedValue(updatedMember);

    const result = await service.updateOnboarding('member-1', true);

    expect(mockRepo.update).toHaveBeenCalledWith('member-1', {
      has_completed_onboarding: true,
    });
    expect(result).toEqual(updatedMember);
  });

  it('should remove member', async () => {
    mockRepo.delete.mockResolvedValue(undefined);

    await service.remove('member-1');

    expect(mockRepo.delete).toHaveBeenCalledWith('member-1');
  });

  describe('findProfileById', () => {
    it('should return member profile with user info', async () => {
      const member = {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        role_ids: ['role-1'],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      const user = {
        id: 'user-1',
        supabase_auth_id: 'auth-1',
        email: 'john@example.com',
        display_name: 'John Doe',
        avatar_url: null,
        bio: 'Engineer',
        graduation_year: 2024,
        current_city: 'NYC',
        current_company: 'Acme',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      mockRepo.findById.mockResolvedValue(member);
      mockUserRepo.findById.mockResolvedValue(user);

      const result = await service.findProfileById('member-1', 'chapter-1');

      expect(mockRepo.findById).toHaveBeenCalledWith('member-1');
      expect(mockUserRepo.findById).toHaveBeenCalledWith('user-1');
      expect(result).toMatchObject({
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-1',
        display_name: 'John Doe',
        email: 'john@example.com',
        bio: 'Engineer',
        graduation_year: 2024,
        current_city: 'NYC',
        current_company: 'Acme',
      });
    });

    it('should throw NotFoundException when member not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.findProfileById('member-x', 'chapter-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findProfileById('member-x', 'chapter-1'),
      ).rejects.toThrow('Member not found');
    });

    it('should throw ForbiddenException when member not in chapter', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'chapter-other',
        role_ids: [],
        has_completed_onboarding: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });

      await expect(
        service.findProfileById('member-1', 'chapter-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.findProfileById('member-1', 'chapter-1'),
      ).rejects.toThrow('Member not in current chapter');
    });
  });

  describe('searchByChapterAndName', () => {
    it('should return matching members by display name', async () => {
      const members = [
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'john@example.com',
          display_name: 'John Doe',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.searchByChapterAndName('chapter-1', 'john');

      expect(mockRepo.findByChapter).toHaveBeenCalledWith('chapter-1');
      expect(mockUserRepo.findByIds).toHaveBeenCalledWith(['user-1']);
      expect(result).toHaveLength(1);
      expect(result[0].display_name).toBe('John Doe');
    });

    it('should return empty array when no members match', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      const result = await service.searchByChapterAndName('chapter-1', 'xyz');

      expect(result).toEqual([]);
    });
  });

  describe('findAlumniByChapter', () => {
    it('should return alumni members with profile info', async () => {
      const alumniRole = {
        id: 'role-alumni',
        chapter_id: 'chapter-1',
        name: 'Alumni',
        permissions: [],
        is_system: true,
        display_order: 5,
        color: null,
        created_at: '2024-01-01',
      };
      const members = [
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'alumni@example.com',
          display_name: 'Alumni User',
          avatar_url: null,
          bio: null,
          graduation_year: 2022,
          current_city: 'Boston',
          current_company: 'Tech Corp',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      mockRoleRepo.findByChapterAndName.mockResolvedValue(alumniRole);
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.findAlumniByChapter('chapter-1');

      expect(mockRoleRepo.findByChapterAndName).toHaveBeenCalledWith(
        'chapter-1',
        'Alumni',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        display_name: 'Alumni User',
        graduation_year: 2022,
        current_city: 'Boston',
        current_company: 'Tech Corp',
      });
    });

    it('should filter alumni by graduation_year', async () => {
      const alumniRole = {
        id: 'role-alumni',
        chapter_id: 'chapter-1',
        name: 'Alumni',
        permissions: [],
        is_system: true,
        display_order: 5,
        color: null,
        created_at: '2024-01-01',
      };
      const members = [
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'member-2',
          user_id: 'user-2',
          chapter_id: 'chapter-1',
          role_ids: ['role-alumni'],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const users = [
        {
          id: 'user-1',
          supabase_auth_id: 'auth-1',
          email: 'a@example.com',
          display_name: 'User 1',
          avatar_url: null,
          bio: null,
          graduation_year: 2022,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'user-2',
          supabase_auth_id: 'auth-2',
          email: 'b@example.com',
          display_name: 'User 2',
          avatar_url: null,
          bio: null,
          graduation_year: 2023,
          current_city: null,
          current_company: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      mockRoleRepo.findByChapterAndName.mockResolvedValue(alumniRole);
      mockRepo.findByChapter.mockResolvedValue(members);
      mockUserRepo.findByIds.mockResolvedValue(users);

      const result = await service.findAlumniByChapter('chapter-1', {
        graduation_year: 2022,
      });

      expect(result).toHaveLength(1);
      expect(result[0].graduation_year).toBe(2022);
    });

    it('should return empty array when no Alumni role exists', async () => {
      mockRoleRepo.findByChapterAndName.mockResolvedValue(null);

      const result = await service.findAlumniByChapter('chapter-1');

      expect(result).toEqual([]);
    });
  });
});
