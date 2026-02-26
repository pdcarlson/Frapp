import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MemberService } from './member.service';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';

describe('MemberService', () => {
  let service: MemberService;
  let mockRepo: jest.Mocked<IMemberRepository>;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: MEMBER_REPOSITORY, useValue: mockRepo },
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

    expect(mockRepo.findByUserAndChapter).toHaveBeenCalledWith('user-1', 'chapter-1');
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
});
