import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleStudyRepository } from './drizzle-study.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleStudyRepository', () => {
  let repository: DrizzleStudyRepository;

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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleStudyRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleStudyRepository>(DrizzleStudyRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findGeofencesByChapter', () => {
    it('should return geofences', async () => {
      const mockGeofence = {
        id: '1',
        chapterId: 'c1',
        name: 'Library',
        coordinates: [{ lat: 10, lng: 20 }],
        isActive: true,
        createdAt: new Date(),
      };
      mockDb.limit.mockResolvedValue([mockGeofence]);
      // Note: limit isn't called in findGeofencesByChapter, but select/from/where are.
      // Drizzle mock behavior depends on chain order.
      // Let's mock the final promise resolution for the chain.
      mockDb.where.mockResolvedValue([mockGeofence]);

      const result = await repository.findGeofencesByChapter('c1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Library');
    });
  });

  describe('createSession', () => {
    it('should create and return a session', async () => {
      const mockSession = {
        id: 's1',
        chapterId: 'c1',
        userId: 'u1',
        geofenceId: 'g1',
        status: 'ACTIVE',
        startTime: new Date(),
        endTime: null,
        lastHeartbeatAt: new Date(),
        totalMinutes: 0,
        pointsAwarded: false,
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockSession]);

      const result = await repository.createSession({
        chapterId: 'c1',
        userId: 'u1',
        geofenceId: 'g1',
        status: 'ACTIVE',
        startTime: new Date(),
        endTime: null,
        lastHeartbeatAt: new Date(),
        totalMinutes: 0,
        pointsAwarded: false,
      });

      expect(result.id).toBe('s1');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
