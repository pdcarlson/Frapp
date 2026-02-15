import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleNotificationRepository } from './drizzle-notification.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleNotificationRepository', () => {
  let repository: DrizzleNotificationRepository;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleNotificationRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleNotificationRepository>(
      DrizzleNotificationRepository,
    );
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('upsertToken', () => {
    it('should insert or update token', async () => {
      const mockResult = {
        id: '1',
        userId: 'u1',
        token: 't1',
        deviceName: 'd1',
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockResult]);

      const result = await repository.upsertToken({
        userId: 'u1',
        token: 't1',
        deviceName: 'd1',
      });
      expect(result.token).toBe('t1');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('createMany', () => {
    it('should insert multiple notifications', async () => {
      const mockResults = [
        {
          id: '1',
          userId: 'u1',
          chapterId: 'c1',
          title: 'T1',
          body: 'B1',
          data: null,
          readAt: null,
          createdAt: new Date(),
        },
        {
          id: '2',
          userId: 'u2',
          chapterId: 'c1',
          title: 'T1',
          body: 'B1',
          data: null,
          readAt: null,
          createdAt: new Date(),
        },
      ];
      mockDb.returning.mockResolvedValue(mockResults);

      const result = await repository.createMany([
        {
          userId: 'u1',
          chapterId: 'c1',
          title: 'T1',
          body: 'B1',
          data: null,
          readAt: null,
        },
        {
          userId: 'u2',
          chapterId: 'c1',
          title: 'T1',
          body: 'B1',
          data: null,
          readAt: null,
        },
      ]);

      expect(result).toHaveLength(2);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
