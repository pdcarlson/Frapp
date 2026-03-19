import { Test, TestingModule } from '@nestjs/testing';
import { InviteController } from './invite.controller';
import { InviteService } from '../../application/services/invite.service';
import { AuthService } from '../../application/services/auth.service';
import {
  CreateInviteDto,
  BatchCreateInvitesDto,
  RedeemInviteDto,
} from '../dtos/invite.dto';

describe('InviteController', () => {
  let controller: InviteController;
  let inviteService: InviteService;

  beforeEach(async () => {
    const mockInviteService = {
      create: jest.fn(),
      createBatch: jest.fn(),
      redeem: jest.fn(),
      findByChapter: jest.fn(),
      revoke: jest.fn(),
    };

    const mockAuthService = {
      // Mock any methods if needed
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InviteController],
      providers: [
        {
          provide: InviteService,
          useValue: mockInviteService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<InviteController>(InviteController);
    inviteService = module.get<InviteService>(InviteService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call inviteService.create with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: CreateInviteDto = { role: 'Member' };
      const expectedResult = { token: 'invite-token-1' };

      jest
        .spyOn(inviteService, 'create')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.create(chapterId, userId, dto);

      expect(inviteService.create).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.role,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('createBatch', () => {
    it('should call inviteService.createBatch with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: BatchCreateInvitesDto = { role: 'Member', count: 5 };
      const expectedResult = [
        { token: 'invite-token-1' },
        { token: 'invite-token-2' },
      ];

      jest
        .spyOn(inviteService, 'createBatch')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.createBatch(chapterId, userId, dto);

      expect(inviteService.createBatch).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.role,
        dto.count,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('redeem', () => {
    it('should call inviteService.redeem with correct arguments', async () => {
      const userId = 'user-1';
      const dto: RedeemInviteDto = { token: 'invite-token-1' };
      const expectedResult = { chapterId: 'chapter-1', memberId: 'member-1' };

      jest
        .spyOn(inviteService, 'redeem')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.redeem(userId, dto);

      expect(inviteService.redeem).toHaveBeenCalledWith(dto.token, userId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('list', () => {
    it('should call inviteService.findByChapter with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = [
        { id: 'inv-1', token: 'token-1', chapter_id: 'chapter-1' },
      ];

      jest
        .spyOn(inviteService, 'findByChapter')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.list(chapterId);

      expect(inviteService.findByChapter).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('revoke', () => {
    it('should call inviteService.revoke with correct arguments and return success', async () => {
      const chapterId = 'chapter-1';
      const inviteId = 'inv-1';

      jest.spyOn(inviteService, 'revoke').mockResolvedValue(undefined as any);

      const result = await controller.revoke(chapterId, inviteId);

      expect(inviteService.revoke).toHaveBeenCalledWith(inviteId, chapterId);
      expect(result).toEqual({ success: true });
    });
  });
});
