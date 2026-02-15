/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleUserRepository } from './drizzle-user.repository';
import { DRIZZLE_DB } from '../drizzle.provider';
import { User } from '../../../domain/entities/user.entity';

describe('DrizzleUserRepository', () => {
  let repository: DrizzleUserRepository;
  let dbMock: any;

  beforeEach(async () => {
    dbMock = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      query: {
        users: {
          findFirst: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleUserRepository,
        {
          provide: DRIZZLE_DB,
          useValue: dbMock,
        },
      ],
    }).compile();

    repository = module.get<DrizzleUserRepository>(DrizzleUserRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('create', () => {
    it('should create a user and return domain entity', async () => {
      const userData = { clerkId: 'clerk_123', email: 'test@example.com' };
      const dbResult = {
        id: 'uuid_123',
        ...userData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.returning.mockResolvedValue([dbResult]);

      const result = await repository.create(userData);

      expect(result).toBeInstanceOf(User);
      expect(result.clerkId).toBe(userData.clerkId);
      expect(dbMock.insert).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a user and return domain entity', async () => {
      const dbResult = {
        id: 'uuid_123',
        clerkId: 'clerk_123',
        email: 'updated@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.returning.mockResolvedValue([dbResult]);

      const result = await repository.update('clerk_123', {
        email: 'updated@example.com',
      });

      expect(result.email).toBe('updated@example.com');
      expect(dbMock.update).toHaveBeenCalled();
    });

    it('should throw error if update returns no result', async () => {
      dbMock.returning.mockResolvedValue([]);

      await expect(
        repository.update('non_existent', { email: 'test@test.com' }),
      ).rejects.toThrow('User with clerkId non_existent not found');
    });
  });

  describe('delete', () => {
    it('should call delete on the database', async () => {
      await repository.delete('clerk_123');
      expect(dbMock.delete).toHaveBeenCalled();
    });
  });

  describe('findByClerkId', () => {
    it('should return user if found', async () => {
      const dbResult = {
        id: 'uuid_123',
        clerkId: 'clerk_123',
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMock.query.users.findFirst.mockResolvedValue(dbResult);

      const result = await repository.findByClerkId('clerk_123');

      expect(result).toBeInstanceOf(User);
      expect(result?.clerkId).toBe('clerk_123');
    });

    it('should return null if not found', async () => {
      dbMock.query.users.findFirst.mockResolvedValue(null);

      const result = await repository.findByClerkId('non_existent');

      expect(result).toBeNull();
    });
  });
});
