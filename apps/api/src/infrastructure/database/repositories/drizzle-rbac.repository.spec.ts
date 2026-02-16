import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleRbacRepository } from './drizzle-rbac.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleRbacRepository', () => {
  let repository: DrizzleRbacRepository;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleRbacRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleRbacRepository>(DrizzleRbacRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('createRole', () => {
    it('should create and return a role', async () => {
      const mockRole = {
        id: 'r1',
        chapterId: 'c1',
        name: 'Admin',
        permissions: ['*'],
        isSystem: false,
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockRole]);

      const result = await repository.createRole({
        chapterId: 'c1',
        name: 'Admin',
        permissions: ['*'],
        isSystem: false,
      });

      expect(result.id).toBe('r1');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('findRolesByChapter', () => {
    it('should return roles for a chapter', async () => {
      const mockRole = {
        id: 'r1',
        chapterId: 'c1',
        name: 'Admin',
        permissions: ['*'],
        isSystem: false,
        createdAt: new Date(),
      };
      // Drizzle mock setup: select -> from -> where
      mockDb.where.mockResolvedValue([mockRole]);

      const result = await repository.findRolesByChapter('c1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Admin');
    });
  });
});
