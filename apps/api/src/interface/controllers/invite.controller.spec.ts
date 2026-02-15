/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InviteController } from './invite.controller';
import { InviteService } from '../../application/services/invite.service';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { RequestWithUser } from '../auth.types';
import { Invite } from '../../domain/entities/invite.entity';

describe('InviteController', () => {
  let controller: InviteController;
  let inviteService: jest.Mocked<InviteService>;

  const mockInvite = new Invite(
    'uuid-123',
    'token-abc',
    'chapter-123',
    'member',
    new Date(),
    'user-123',
    null,
    new Date(),
  );

  const mockInviteService = {
    createInvite: jest.fn(),
    acceptInvite: jest.fn(),
  };

  const mockRequest = {
    user: { sub: 'user_123' },
  } as unknown as RequestWithUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InviteController],
      providers: [
        {
          provide: InviteService,
          useValue: mockInviteService,
        },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InviteController>(InviteController);
    inviteService = module.get(InviteService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an invite and return it', async () => {
      inviteService.createInvite.mockResolvedValue(mockInvite);

      const result = await controller.create(
        'chapter-123',
        { role: 'member' },
        mockRequest,
      );

      expect(result).toEqual(mockInvite);
      expect(inviteService.createInvite).toHaveBeenCalledWith({
        chapterId: 'chapter-123',
        role: 'member',
        createdBy: 'user_123',
      });
    });
  });

  describe('accept', () => {
    it('should accept an invite and return it', async () => {
      inviteService.acceptInvite.mockResolvedValue(mockInvite);

      const result = await controller.accept(
        { token: 'token-abc' },
        mockRequest,
      );

      expect(result).toEqual(mockInvite);
      expect(inviteService.acceptInvite).toHaveBeenCalledWith(
        'token-abc',
        'user_123',
      );
    });
  });
});
