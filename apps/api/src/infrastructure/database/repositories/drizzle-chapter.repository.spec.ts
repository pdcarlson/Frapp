/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
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
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
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
        university: 'OSU',
        clerkOrganizationId: 'org_123',
      };
      const dbResult = {
        id: 'uuid_123',
        ...chapterData,
        stripeCustomerId: null,
        subscriptionStatus: 'incomplete',
        subscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.returning.mockResolvedValue([dbResult]);

      const result = await repository.create(chapterData);

      expect(result).toBeInstanceOf(Chapter);
      expect(result.university).toBe(chapterData.university);
      expect(dbMock.insert).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a chapter and return domain entity', async () => {
      const dbResult = {
        id: 'uuid_123',
        name: 'Updated Name',
        university: 'OSU',
        clerkOrganizationId: 'org_123',
        stripeCustomerId: null,
        subscriptionStatus: 'active',
        subscriptionId: 'sub_123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.returning.mockResolvedValue([dbResult]);

      const result = await repository.update('uuid_123', {
        name: 'Updated Name',
        subscriptionStatus: 'active',
      });

      expect(result.subscriptionStatus).toBe('active');
      expect(dbMock.update).toHaveBeenCalled();
    });
  });

  describe('findByClerkOrganizationId', () => {
    it('should return chapter if found', async () => {
      const dbResult = {
        id: 'uuid_123',
        name: 'Alpha Beta',
        university: 'OSU',
        clerkOrganizationId: 'org_123',
        stripeCustomerId: null,
        subscriptionStatus: 'active',
        subscriptionId: 'sub_123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.query.chapters.findFirst.mockResolvedValue(dbResult);

      const result = await repository.findByClerkOrganizationId('org_123');

      expect(result).toBeInstanceOf(Chapter);
      expect(result?.clerkOrganizationId).toBe('org_123');
    });
  });

  describe('findByStripeCustomerId', () => {
    it('should return chapter if found by stripe customer id', async () => {
      const dbResult = {
        id: 'uuid_123',
        name: 'Alpha Beta',
        university: 'OSU',
        clerkOrganizationId: 'org_123',
        stripeCustomerId: 'cus_123',
        subscriptionStatus: 'active',
        subscriptionId: 'sub_123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.query.chapters.findFirst.mockResolvedValue(dbResult);

      const result = await repository.findByStripeCustomerId('cus_123');

      expect(result).toBeInstanceOf(Chapter);
      expect(result?.stripeCustomerId).toBe('cus_123');
    });
  });
});
