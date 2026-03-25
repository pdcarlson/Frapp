import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';

describe('UserService', () => {
  let service: UserService;
  let mockRepo: jest.Mocked<IUserRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      deleteFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: USER_REPOSITORY, useValue: mockRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
      ],
    }).compile();

    service = module.get(UserService);
  });

  it('should return user when found', async () => {
    const user = {
      id: 'user-1',
      supabase_auth_id: 'auth-123',
      email: 'test@example.com',
      display_name: 'test',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockRepo.findById.mockResolvedValue(user);

    const result = await service.findById('user-1');

    expect(mockRepo.findById).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(user);
  });

  it('should throw NotFoundException when user not found', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.findById('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findById('nonexistent')).rejects.toThrow(
      'User not found',
    );
  });

  it('should update user profile data', async () => {
    const updatedUser = {
      id: 'user-1',
      supabase_auth_id: 'auth-123',
      email: 'test@example.com',
      display_name: 'Updated Name',
      avatar_url: null,
      bio: 'New bio',
      graduation_year: 2024,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockRepo.update.mockResolvedValue(updatedUser);

    const result = await service.update('user-1', {
      display_name: 'Updated Name',
      bio: 'New bio',
      graduation_year: 2024,
    });

    expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
      display_name: 'Updated Name',
      bio: 'New bio',
      graduation_year: 2024,
    });
    expect(result).toEqual(updatedUser);
  });

  describe('requestAvatarUploadUrl', () => {
    it('should throw BadRequestException for invalid file extension', async () => {
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.exe',
          'image/jpeg',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.exe',
          'image/jpeg',
        ),
      ).rejects.toThrow('File extension is not allowed');

      expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid content type', async () => {
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.jpg',
          'application/exe',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.jpg',
          'application/exe',
        ),
      ).rejects.toThrow('Content type "application/exe" is not allowed');

      expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
    });
    it('should return signed URL and storage path for profile photo', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.supabase.co/profiles/upload/signed',
      );

      const result = await service.requestAvatarUploadUrl(
        'ch-1',
        'user-1',
        'avatar.jpg',
        'image/jpeg',
      );

      expect(result.signedUrl).toBe(
        'https://storage.supabase.co/profiles/upload/signed',
      );
      expect(result.storagePath).toBe(
        'chapters/ch-1/profiles/user-1/avatar.jpg',
      );
      expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
        'profiles',
        'chapters/ch-1/profiles/user-1/avatar.jpg',
        'image/jpeg',
      );
    });
  });
});
