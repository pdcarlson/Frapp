/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { UserSyncService } from './user-sync.service';
import {
  USER_REPOSITORY,
  IUserRepository,
} from '../../domain/repositories/user.repository.interface';
import { Logger } from '@nestjs/common';
import { User } from '../../domain/entities/user.entity';

describe('UserSyncService', () => {
  let service: UserSyncService;
  let repository: jest.Mocked<IUserRepository>;

  const mockUser = new User(
    'uuid-123',
    'user_123',
    'test@example.com',
    new Date(),
    new Date(),
  );

  beforeEach(async () => {
    const mockRepo: Partial<jest.Mocked<IUserRepository>> = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByClerkId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSyncService,
        {
          provide: USER_REPOSITORY,
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<UserSyncService>(UserSyncService);
    repository = module.get(USER_REPOSITORY);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleUserCreated', () => {
    it('should create a new user in the repository', async () => {
      const data = {
        id: 'user_123',
        email_addresses: [{ email_address: 'test@example.com' }],
      };
      repository.create.mockResolvedValue(mockUser);

      await service.handleUserCreated(data);

      expect(repository.create).toHaveBeenCalledWith({
        clerkId: 'user_123',
        email: 'test@example.com',
      });
    });

    it('should log an error if creation fails', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const data = {
        id: 'user_123',
        email_addresses: [{ email_address: 'test@example.com' }],
      };
      repository.create.mockRejectedValue(new Error('DB Error'));

      await expect(service.handleUserCreated(data)).rejects.toThrow('DB Error');
      expect(loggerSpy).toHaveBeenCalled();
    });
  });

  describe('handleUserUpdated', () => {
    it('should update user if they exist', async () => {
      const data = {
        id: 'user_123',
        email_addresses: [{ email_address: 'new@example.com' }],
      };
      repository.findByClerkId.mockResolvedValue(mockUser);
      repository.update.mockResolvedValue(mockUser);

      await service.handleUserUpdated(data);

      expect(repository.update).toHaveBeenCalledWith('user_123', {
        email: 'new@example.com',
      });
    });

    it('should create user if they do not exist (idempotency)', async () => {
      const data = {
        id: 'user_123',
        email_addresses: [{ email_address: 'new@example.com' }],
      };
      repository.findByClerkId.mockResolvedValue(null);
      repository.create.mockResolvedValue(mockUser);

      await service.handleUserUpdated(data);

      expect(repository.create).toHaveBeenCalled();
    });
  });

  describe('handleUserDeleted', () => {
    it('should delete user from repository', async () => {
      const data = { id: 'user_123' };
      repository.delete.mockResolvedValue(undefined);

      await service.handleUserDeleted(data);

      expect(repository.delete).toHaveBeenCalledWith('user_123');
    });
  });
});
