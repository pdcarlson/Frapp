/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleInviteRepository } from './drizzle-invite.repository';
import { DRIZZLE_DB } from '../drizzle.provider';
import { Invite } from '../../../domain/entities/invite.entity';

describe('DrizzleInviteRepository', () => {
  let repository: DrizzleInviteRepository;
  let dbMock: any;

  beforeEach(async () => {
    dbMock = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      query: {
        invites: {
          findFirst: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleInviteRepository,
        {
          provide: DRIZZLE_DB,
          useValue: dbMock,
        },
      ],
    }).compile();

    repository = module.get<DrizzleInviteRepository>(DrizzleInviteRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('create', () => {
    it('should create an invite and return domain entity', async () => {
      const inviteData = {
        token: 'token_123',
        chapterId: 'chapter_123',
        role: 'member',
        expiresAt: new Date(),
        createdBy: 'user_123',
      };
      const dbResult = {
        id: 'uuid_123',
        ...inviteData,
        usedAt: null,
        createdAt: new Date(),
      };
      dbMock.returning.mockResolvedValue([dbResult]);

      const result = await repository.create(inviteData);

      expect(result).toBeInstanceOf(Invite);
      expect(result.token).toBe(inviteData.token);
      expect(dbMock.insert).toHaveBeenCalled();
    });
  });

  describe('findByToken', () => {
    it('should return invite if found', async () => {
      const dbResult = {
        id: 'uuid_123',
        token: 'token_123',
        chapterId: 'chapter_123',
        role: 'member',
        expiresAt: new Date(),
        createdBy: 'user_123',
        usedAt: null,
        createdAt: new Date(),
      };
      dbMock.query.invites.findFirst.mockResolvedValue(dbResult);

      const result = await repository.findByToken('token_123');

      expect(result).toBeInstanceOf(Invite);
      expect(result?.token).toBe('token_123');
    });
  });
});
