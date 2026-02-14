import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleChapterRepository } from './drizzle-chapter.repository';
import { DRIZZLE_DB } from '../drizzle.provider';
import { Chapter } from '../../../domain/entities/chapter.entity';

describe('DrizzleChapterRepository', () => {
  let repository: DrizzleChapterRepository;
  let dbMock: any;

  beforeEach(async () => {
    dbMock = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      query: {
        chapters: {
          findFirst: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleChapterRepository,
        {
          provide: DRIZZLE_DB,
          useValue: dbMock,
        },
      ],
    }).compile();

    repository = module.get<DrizzleChapterRepository>(DrizzleChapterRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('create', () => {
    it('should create a chapter and return domain entity', async () => {
      const chapterData = {
        name: 'Alpha Beta',
        clerkOrganizationId: 'org_123',
      };
      const dbResult = {
        id: 'uuid_123',
        ...chapterData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.returning.mockResolvedValue([dbResult]);

      const result = await repository.create(chapterData);

      expect(result).toBeInstanceOf(Chapter);
      expect(result.name).toBe(chapterData.name);
      expect(dbMock.insert).toHaveBeenCalled();
    });
  });

  describe('findByClerkOrganizationId', () => {
    it('should return chapter if found', async () => {
      const dbResult = {
        id: 'uuid_123',
        name: 'Alpha Beta',
        clerkOrganizationId: 'org_123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.query.chapters.findFirst.mockResolvedValue(dbResult);

      const result = await repository.findByClerkOrganizationId('org_123');

      expect(result).toBeInstanceOf(Chapter);
      expect(result?.clerkOrganizationId).toBe('org_123');
    });
  });
});
