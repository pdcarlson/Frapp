import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleBackworkRepository } from './drizzle-backwork.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleBackworkRepository', () => {
  let repository: DrizzleBackworkRepository;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleBackworkRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleBackworkRepository>(
      DrizzleBackworkRepository,
    );
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findCourseByCode', () => {
    it('should return a course if found', async () => {
      const mockCourse = {
        id: '1',
        chapterId: 'c1',
        code: 'CS101',
        name: 'Intro to CS',
        createdAt: new Date(),
      };
      mockDb.limit.mockResolvedValue([mockCourse]);

      const result = await repository.findCourseByCode('c1', 'CS101');
      expect(result).toEqual(expect.objectContaining({ code: 'CS101' }));
    });

    it('should return null if not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      const result = await repository.findCourseByCode('c1', 'CS101');
      expect(result).toBeNull();
    });
  });

  describe('createCourse', () => {
    it('should create and return a course', async () => {
      const mockCourse = {
        id: '1',
        chapterId: 'c1',
        code: 'CS101',
        name: 'Intro to CS',
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockCourse]);

      const result = await repository.createCourse({
        chapterId: 'c1',
        code: 'CS101',
        name: 'Intro to CS',
      });
      expect(result).toEqual(expect.objectContaining({ code: 'CS101' }));
    });
  });

  // Additional tests for Professors and Resources would follow the same pattern
});
