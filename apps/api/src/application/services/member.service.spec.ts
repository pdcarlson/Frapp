import { Test, TestingModule } from '@nestjs/testing';
import { MemberService } from './member.service';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { NotFoundException } from '@nestjs/common';

describe('MemberService', () => {
  let service: MemberService;
  let memberRepo: {
    findById: jest.Mock;
    findByChapter: jest.Mock;
    updateRoles: jest.Mock;
  };

  const mockMemberRepo = {
    findById: jest.fn(),
    findByChapter: jest.fn(),
    updateRoles: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
    memberRepo = mockMemberRepo;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignRoles', () => {
    it('should update roles if member exists', async () => {
      const memberId = 'm1';
      const roleIds = ['r1'];
      memberRepo.findById.mockResolvedValue({ id: memberId });
      memberRepo.updateRoles.mockResolvedValue({ id: memberId, roleIds });

      const result = await service.assignRoles(memberId, roleIds);
      expect(result.roleIds).toEqual(roleIds);
      expect(memberRepo.updateRoles).toHaveBeenCalledWith(memberId, roleIds);
    });

    it('should throw NotFoundException if member not found', async () => {
      memberRepo.findById.mockResolvedValue(null);
      await expect(service.assignRoles('m1', [])).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMembersByChapter', () => {
    it('should return members from repository', async () => {
      const chapterId = 'c1';
      const members = [{ id: 'm1' }];
      memberRepo.findByChapter.mockResolvedValue(members);

      const result = await service.getMembersByChapter(chapterId);
      expect(result).toEqual(members);
      expect(memberRepo.findByChapter).toHaveBeenCalledWith(chapterId);
    });
  });
});
