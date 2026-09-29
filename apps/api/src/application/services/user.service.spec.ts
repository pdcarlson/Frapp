import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import { ProfilePhotoUrlService } from './profile-photo-url.service';

describe('UserService', () => {
  let service: UserService;
  let mockRepo: jest.Mocked<IUserRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      getSignedDownloadUrls: jest.fn().mockResolvedValue({}),
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      listFiles: jest.fn(),
      listObjects: jest.fn().mockResolvedValue([]),
      listFolders: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        ProfilePhotoUrlService,
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
    const existingUser = {
      id: 'user-1',
      supabase_auth_id: 'auth-123',
      email: 'test@example.com',
      display_name: 'Old Name',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      deleted_at: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    const updatedUser = {
      ...existingUser,
      display_name: 'Updated Name',
      bio: 'New bio',
      graduation_year: 2024,
      updated_at: '2024-01-02',
    };
    mockRepo.findById.mockResolvedValue(existingUser);
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

  it('should reject profile updates on a tombstoned (deleted) account', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 'user-1',
      supabase_auth_id: 'auth-123',
      email: 'deleted+user-1@anonymized.invalid',
      display_name: 'Deleted User',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      deleted_at: '2026-08-03T00:00:00Z',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await expect(
      service.update('user-1', { display_name: 'Sneaky Comeback' }),
    ).rejects.toThrow(GoneException);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  describe('requestAvatarUploadUrl', () => {
    const UUID_KEY = /^chapters\/ch-1\/profiles\/user-1\/[0-9a-f-]{36}\.jpg$/;

    it('mints a unique key, so a second photo.jpg never collides (#732)', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue('https://put');

      const first = await service.requestAvatarUploadUrl(
        'ch-1',
        'user-1',
        'photo.jpg',
        'image/jpeg',
      );
      const second = await service.requestAvatarUploadUrl(
        'ch-1',
        'user-1',
        'photo.jpg',
        'image/jpeg',
      );

      expect(first.storagePath).toMatch(UUID_KEY);
      expect(second.storagePath).toMatch(UUID_KEY);
      expect(first.storagePath).not.toBe(second.storagePath);
    });

    it('never puts the client filename in the key', async () => {
      const result = await service.requestAvatarUploadUrl(
        'ch-1',
        'user-1',
        '../../Résumé #3.JPG',
        'image/jpeg',
      );

      expect(result.storagePath).toMatch(UUID_KEY);
    });

    it('should throw BadRequestException for invalid file extension', async () => {
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.exe',
          'image/jpeg',
        ),
      ).rejects.toThrow('File extension is not allowed');
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.svg',
          'image/svg+xml',
        ),
      ).rejects.toThrow(BadRequestException);

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
      ).rejects.toThrow('Content type "application/exe" is not allowed');

      expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects a declared size over the upload ceiling before minting', async () => {
      await expect(
        service.requestAvatarUploadUrl(
          'ch-1',
          'user-1',
          'avatar.jpg',
          'image/jpeg',
          26 * 1024 * 1024,
        ),
      ).rejects.toThrow('File exceeds the 25 MB upload limit');

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
        1024,
      );

      expect(result.signedUrl).toBe(
        'https://storage.supabase.co/profiles/upload/signed',
      );
      expect(result.storagePath).toMatch(UUID_KEY);
      expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
        'profiles',
        result.storagePath,
        'image/jpeg',
      );
    });
  });

  describe('profile photo confirm, remove and read', () => {
    const FOLDER = 'chapters/ch-1/profiles/user-1';
    const NEW_PATH = `${FOLDER}/new.jpg`;

    function userWith(avatar_url: string | null, deleted_at?: string) {
      return {
        id: 'user-1',
        supabase_auth_id: 'auth-123',
        email: 'test@example.com',
        display_name: 'Test',
        avatar_url,
        bio: null,
        graduation_year: null,
        current_city: null,
        current_company: null,
        deleted_at: deleted_at ?? null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
    }

    beforeEach(() => {
      mockRepo.update.mockImplementation(async (_id, data) => ({
        ...userWith(null),
        ...data,
      }));
      mockStorageProvider.getSignedDownloadUrls.mockImplementation(
        async (_bucket, paths) =>
          Object.fromEntries(paths.map((path) => [path, `signed:${path}`])),
      );
    });

    it('stores the path, deletes the replaced photo and stray uploads, and returns it signed', async () => {
      mockRepo.findById.mockResolvedValue(userWith(`${FOLDER}/old.jpg`));
      mockStorageProvider.listFiles.mockResolvedValue([
        `${FOLDER}/old.jpg`,
        `${FOLDER}/never-confirmed.png`,
        NEW_PATH,
      ]);

      const result = await service.confirmAvatarUpload(
        'ch-1',
        'user-1',
        NEW_PATH,
      );

      expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
        avatar_url: NEW_PATH,
      });
      expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('profiles', [
        `${FOLDER}/old.jpg`,
        `${FOLDER}/never-confirmed.png`,
      ]);
      expect(result.avatar_url).toBe(`signed:${NEW_PATH}`);
    });

    it("also deletes the previous photo when it sits in another chapter's folder", async () => {
      const elsewhere = 'chapters/ch-2/profiles/user-1/old.jpg';
      mockRepo.findById.mockResolvedValue(userWith(elsewhere));
      mockStorageProvider.listFiles.mockResolvedValue([NEW_PATH]);

      await service.confirmAvatarUpload('ch-1', 'user-1', NEW_PATH);

      expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('profiles', [
        elsewhere,
      ]);
    });

    it.each([
      ['another member', 'chapters/ch-1/profiles/user-2/x.jpg'],
      ['another chapter', 'chapters/ch-2/profiles/user-1/x.jpg'],
      ['a nested key', `${FOLDER}/a/x.jpg`],
      ['a dot segment', `${FOLDER}/..`],
      ['a URL', `https://evil.example/${NEW_PATH}`],
    ])('refuses a path into %s without writing', async (_label, path) => {
      mockRepo.findById.mockResolvedValue(userWith(null));

      await expect(
        service.confirmAvatarUpload('ch-1', 'user-1', path),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.update).not.toHaveBeenCalled();
      expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
    });

    it('refuses to confirm a path with nothing uploaded behind it', async () => {
      mockRepo.findById.mockResolvedValue(userWith(`${FOLDER}/old.jpg`));
      mockStorageProvider.listFiles.mockResolvedValue([`${FOLDER}/old.jpg`]);

      await expect(
        service.confirmAvatarUpload('ch-1', 'user-1', NEW_PATH),
      ).rejects.toThrow('No uploaded photo at storage_path');
      expect(mockRepo.update).not.toHaveBeenCalled();
      expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
    });

    it('refuses a tombstoned account', async () => {
      mockRepo.findById.mockResolvedValue(
        userWith(null, '2026-08-03T00:00:00Z'),
      );

      await expect(
        service.confirmAvatarUpload('ch-1', 'user-1', NEW_PATH),
      ).rejects.toThrow(GoneException);
      await expect(service.removeAvatar('user-1')).rejects.toThrow(
        GoneException,
      );
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('keeps the new photo when deleting the old one fails', async () => {
      mockRepo.findById.mockResolvedValue(userWith(`${FOLDER}/old.jpg`));
      mockStorageProvider.listFiles.mockResolvedValue([
        `${FOLDER}/old.jpg`,
        NEW_PATH,
      ]);
      mockStorageProvider.deleteFiles.mockRejectedValue(new Error('down'));

      const result = await service.confirmAvatarUpload(
        'ch-1',
        'user-1',
        NEW_PATH,
      );

      expect(result.avatar_url).toBe(`signed:${NEW_PATH}`);
    });

    it('removes the photo and deletes its object', async () => {
      mockRepo.findById.mockResolvedValue(userWith(`${FOLDER}/old.jpg`));

      const result = await service.removeAvatar('user-1');

      expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
        avatar_url: null,
      });
      expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('profiles', [
        `${FOLDER}/old.jpg`,
      ]);
      expect(result.avatar_url).toBeNull();
    });

    it("clears but never deletes a stored path that is not the user's own object", async () => {
      mockRepo.findById.mockResolvedValue(
        userWith('chapters/ch-1/profiles/user-2/theirs.jpg'),
      );

      await service.removeAvatar('user-1');

      expect(mockRepo.update).toHaveBeenCalledWith('user-1', {
        avatar_url: null,
      });
      expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
    });

    it('is a no-op without a photo', async () => {
      mockRepo.findById.mockResolvedValue(userWith(null));

      await service.removeAvatar('user-1');

      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('findProfile serves the stored path as a signed URL', async () => {
      mockRepo.findById.mockResolvedValue(userWith(NEW_PATH));

      const result = await service.findProfile('user-1');

      expect(result.avatar_url).toBe(`signed:${NEW_PATH}`);
    });
  });
});
