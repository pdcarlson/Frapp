/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { MemberController } from './member.controller';
import { MemberService } from '../../application/services/member.service';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ForbiddenException } from '@nestjs/common';

describe('MemberController', () => {
  let controller: MemberController;
  let service: MemberService;

  const mockMemberService = {
    getMembersByChapter: jest.fn(),
    getMember: jest.fn(),
    assignRoles: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberController],
      providers: [{ provide: MemberService, useValue: mockMemberService }],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MemberController>(MemberController);
    service = module.get<MemberService>(MemberService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET / should call service.getMembersByChapter', async () => {
    const chapterId = 'c1';
    await controller.getMembers(chapterId);
    expect(service.getMembersByChapter).toHaveBeenCalledWith(chapterId);
  });

  describe('PATCH :id/roles', () => {
    it('should call assignRoles if member belongs to chapter', async () => {
      const memberId = 'm1';
      const chapterId = 'c1';
      const roleIds = ['r1'];
      (service.getMember as jest.Mock).mockResolvedValue({
        id: memberId,
        chapterId,
      });

      await controller.updateRoles(memberId, chapterId, { roleIds });
      expect(service.assignRoles).toHaveBeenCalledWith(memberId, roleIds);
    });

    it('should throw ForbiddenException if member belongs to different chapter', async () => {
      const memberId = 'm1';
      const chapterId = 'c1';
      (service.getMember as jest.Mock).mockResolvedValue({
        id: memberId,
        chapterId: 'other',
      });

      await expect(
        controller.updateRoles(memberId, chapterId, { roleIds: [] }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
