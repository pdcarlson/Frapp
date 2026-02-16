import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleMemberRepository } from './drizzle-member.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleMemberRepository', () => {
  let repository: DrizzleMemberRepository;

  const mockDb = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    query: {
      members: {
        findFirst: jest.fn(),
      },
    },
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleMemberRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleMemberRepository>(DrizzleMemberRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('create', () => {
    it('should create and return a member', async () => {
      const mockMember = {
        id: 'm1',
        userId: 'u1',
        chapterId: 'c1',
        roleIds: ['r1'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockMember]);

      const result = await repository.create({
        userId: 'u1',
        chapterId: 'c1',
        roleIds: ['r1'],
      });

      expect(result.id).toBe('m1');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('findByUserAndChapter', () => {
    it('should return a member if found', async () => {
      const mockMember = {
        id: 'm1',
        userId: 'u1',
        chapterId: 'c1',
        roleIds: ['r1'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.query.members.findFirst.mockResolvedValue(mockMember);

      const result = await repository.findByUserAndChapter('u1', 'c1');
      expect(result?.id).toBe('m1');
    });
  });
});
