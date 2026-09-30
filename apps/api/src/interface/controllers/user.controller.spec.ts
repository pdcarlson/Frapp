import { InternalServerErrorException } from '@nestjs/common';
import { UserController } from './user.controller';
import type { UserService } from '../../application/services/user.service';
import type { AccountDeletionService } from '../../application/services/account-deletion.service';
import type { RbacService } from '../../application/services/rbac.service';
import type { LegalAcceptanceService } from '../../application/services/legal-acceptance.service';

describe('UserController', () => {
  let controller: UserController;
  const userService = {
    requestAvatarUploadUrl: jest.fn(),
    confirmAvatarUpload: jest.fn(),
    removeAvatar: jest.fn(),
    findProfile: jest.fn(),
    update: jest.fn(),
    withSignedPhoto: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Constructed directly: the handlers are what is under test, and the
    // class-level `AuthSyncInterceptor` would otherwise need `AuthService`.
    controller = new UserController(
      userService as unknown as UserService,
      {} as AccountDeletionService,
      {} as RbacService,
      {} as LegalAcceptanceService,
    );
  });

  describe('requestAvatarUploadUrl', () => {
    const dto = {
      filename: 'me.png',
      content_type: 'image/png',
      size_bytes: 2048,
    };

    // `readSignedUpload` reads only the snake_case names, so the camelCase
    // this route used to return was unreadable by every client (#732).
    it('maps the camelCase service ticket onto the snake_case wire contract', async () => {
      userService.requestAvatarUploadUrl.mockResolvedValue({
        signedUrl: 'https://storage.example/put',
        storagePath: 'chapters/ch-1/profiles/user-1/u.png',
      });

      await expect(
        controller.requestAvatarUploadUrl('user-1', 'ch-1', dto),
      ).resolves.toEqual({
        upload_url: 'https://storage.example/put',
        storage_path: 'chapters/ch-1/profiles/user-1/u.png',
      });
      expect(userService.requestAvatarUploadUrl).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
        'me.png',
        'image/png',
        2048,
      );
    });

    it('fails loudly on an empty ticket rather than returning one', async () => {
      userService.requestAvatarUploadUrl.mockResolvedValue({
        signedUrl: '',
        storagePath: 'chapters/ch-1/profiles/user-1/u.png',
      });

      await expect(
        controller.requestAvatarUploadUrl('user-1', 'ch-1', dto),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  it('confirms against the caller and the active chapter', async () => {
    userService.confirmAvatarUpload.mockResolvedValue({ id: 'user-1' });

    await controller.confirmAvatarUpload('user-1', 'ch-1', {
      storage_path: 'chapters/ch-1/profiles/user-1/u.png',
    });

    expect(userService.confirmAvatarUpload).toHaveBeenCalledWith(
      'ch-1',
      'user-1',
      'chapters/ch-1/profiles/user-1/u.png',
    );
  });

  it('serves the caller profile and the PATCH result with a signed photo', async () => {
    userService.findProfile.mockResolvedValue({ id: 'user-1' });
    userService.update.mockResolvedValue({ id: 'user-1', avatar_url: 'p' });
    userService.withSignedPhoto.mockResolvedValue({
      id: 'user-1',
      avatar_url: 'signed',
    });

    await expect(controller.getMe('user-1')).resolves.toEqual({
      id: 'user-1',
    });
    await expect(
      controller.updateMe('user-1', { display_name: 'Ann' }),
    ).resolves.toEqual({ id: 'user-1', avatar_url: 'signed' });
    expect(userService.withSignedPhoto).toHaveBeenCalledWith({
      id: 'user-1',
      avatar_url: 'p',
    });
  });
});
