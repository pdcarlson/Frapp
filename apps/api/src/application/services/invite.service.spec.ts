/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InviteService } from './invite.service';
import {
  INVITE_REPOSITORY,
  IInviteRepository,
} from '../../domain/repositories/invite.repository.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import { Invite } from '../../domain/entities/invite.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('InviteService', () => {
  let service: InviteService;
  let inviteRepo: jest.Mocked<IInviteRepository>;

  const mockInvite = new Invite(
    'uuid-123',
    'token-abc',
    'chapter-123',
    'member',
    new Date(Date.now() + 10000), // 10s in future
    'user-123',
    null,
    new Date(),
  );

  beforeEach(async () => {
    const mockInviteRepo: Partial<jest.Mocked<IInviteRepository>> = {
      create: jest.fn(),
      findByToken: jest.fn(),
      markAsUsed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: INVITE_REPOSITORY, useValue: mockInviteRepo },
        { provide: CHAPTER_REPOSITORY, useValue: {} },
        { provide: USER_REPOSITORY, useValue: {} },
      ],
    }).compile();

    service = module.get<InviteService>(InviteService);
    inviteRepo = module.get(INVITE_REPOSITORY);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvite', () => {
    it('should generate a token and save the invite', async () => {
      inviteRepo.create.mockResolvedValue(mockInvite);

      const result = await service.createInvite({
        chapterId: 'chapter-123',
        role: 'member',
        createdBy: 'user-123',
      });

      expect(result.token).toBeDefined();
      expect(inviteRepo.create).toHaveBeenCalled();
    });
  });

  describe('acceptInvite', () => {
    it('should throw NotFoundException if token does not exist', async () => {
      inviteRepo.findByToken.mockResolvedValue(null);

      await expect(
        service.acceptInvite('invalid-token', 'user-456'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if token is already used', async () => {
      const usedInvite = new Invite(
        'id',
        'tok',
        'chap',
        'role',
        new Date(Date.now() + 1000),
        'user',
        new Date(),
        new Date(),
      );
      inviteRepo.findByToken.mockResolvedValue(usedInvite);

      await expect(service.acceptInvite('tok', 'user-456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if token is expired', async () => {
      const expiredInvite = new Invite(
        'id',
        'tok',
        'chap',
        'role',
        new Date(Date.now() - 1000),
        'user',
        null,
        new Date(),
      );
      inviteRepo.findByToken.mockResolvedValue(expiredInvite);

      await expect(service.acceptInvite('tok', 'user-456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
