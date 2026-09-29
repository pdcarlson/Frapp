import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import {
  ACCOUNT_DELETED_MESSAGE,
  MAX_UPLOAD_LABEL,
  fileExtension,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
} from '@repo/validation';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { User } from '#domain/entities/user.entity';
import {
  PROFILES_BUCKET,
  parseProfilePhotoPath,
  profileFolderPrefix,
} from '#domain/constants/storage';
import { ProfilePhotoUrlService } from './profile-photo-url.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly photoUrls: ProfilePhotoUrlService,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    // Tombstone guard: during account deletion there is a short window where
    // the auth account (and therefore the caller's token) still works after
    // the PII scrub. Without this check a profile edit landing in that window
    // would write PII back onto the anonymized row.
    const existing = await this.userRepo.findById(id);
    if (!existing) throw new NotFoundException('User not found');
    if (existing.deleted_at) {
      throw new GoneException(ACCOUNT_DELETED_MESSAGE);
    }
    return this.userRepo.update(id, data);
  }

  /** {@link findById} with `avatar_url` made renderable, for the caller's own profile. */
  async findProfile(id: string): Promise<User> {
    return this.withSignedPhoto(await this.findById(id));
  }

  /** `avatar_url` made renderable; see {@link ProfilePhotoUrlService}. */
  withSignedPhoto(user: User): Promise<User> {
    return this.photoUrls.signRow(user, user.id);
  }

  /**
   * Mint a signed upload URL for a new profile photo.
   *
   * The key is server-minted and unique per request, not the member's
   * filename: signed uploads never overwrite, so re-using `photo.jpg` would
   * answer 409 on the second upload of a file with the same name. The
   * extension is kept because storage serves nothing else to type the object.
   */
  async requestAvatarUploadUrl(
    chapterId: string,
    userId: string,
    filename: string,
    contentType: string,
    sizeBytes?: number,
  ): Promise<{ signedUrl: string; storagePath: string }> {
    const ext = fileExtension(filename);

    if (!isAllowedUploadExtension('image', ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!isAllowedUploadMime('image', contentType)) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed`,
      );
    }

    if (sizeBytes !== undefined && !isWithinUploadSizeLimit(sizeBytes)) {
      throw new BadRequestException(
        `File exceeds the ${MAX_UPLOAD_LABEL} upload limit`,
      );
    }

    const storagePath = `${profileFolderPrefix(chapterId, userId)}/${crypto.randomUUID()}.${ext}`;
    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      PROFILES_BUCKET,
      storagePath,
      contentType,
    );
    return { signedUrl, storagePath };
  }

  /**
   * Make an uploaded object the caller's profile photo.
   *
   * The path must sit directly in the caller's own folder for the chapter the
   * request is scoped to, which is where `requestAvatarUploadUrl` puts it, and
   * the object must exist: a confirm with nothing behind it would otherwise
   * store a photo that renders broken on every surface. Older objects in that
   * folder (the replaced photo, uploads never confirmed) and the previous photo
   * in another chapter's folder are then deleted, best-effort. The member's
   * photo has already changed by then, and whatever a failed delete leaves is
   * still under the member's own folders, which a chapter departure and an
   * account deletion purge in full (#711).
   */
  async confirmAvatarUpload(
    chapterId: string,
    userId: string,
    storagePath: string,
  ): Promise<User> {
    const folder = profileFolderPrefix(chapterId, userId);
    const parsed = parseProfilePhotoPath(storagePath);
    if (!parsed || parsed.folder !== folder) {
      throw new BadRequestException(
        'storage_path must be a photo in your own profile folder',
      );
    }

    const existing = await this.requireLiveUser(userId);
    const stored = await this.storageProvider.listFiles(
      PROFILES_BUCKET,
      folder,
    );
    if (!stored.includes(storagePath)) {
      throw new BadRequestException(
        'No uploaded photo at storage_path. Upload it before confirming.',
      );
    }

    const user = await this.userRepo.update(userId, {
      avatar_url: storagePath,
    });

    const stale = stored.filter((path) => path !== storagePath);
    const previous = this.ownPhotoPath(existing);
    if (previous && previous !== storagePath && !stale.includes(previous)) {
      stale.push(previous);
    }
    await this.deletePhotosQuietly(userId, stale);

    return this.withSignedPhoto(user);
  }

  /** Clear the caller's profile photo and delete the object behind it. */
  async removeAvatar(userId: string): Promise<User> {
    const existing = await this.requireLiveUser(userId);
    if (!existing.avatar_url) return this.withSignedPhoto(existing);

    const user = await this.userRepo.update(userId, { avatar_url: null });
    const previous = this.ownPhotoPath(existing);
    if (previous) await this.deletePhotosQuietly(userId, [previous]);
    return this.withSignedPhoto(user);
  }

  /** The user row, refusing a missing or tombstoned account like `update`. */
  private async requireLiveUser(id: string): Promise<User> {
    const existing = await this.userRepo.findById(id);
    if (!existing) throw new NotFoundException('User not found');
    if (existing.deleted_at) {
      throw new GoneException(ACCOUNT_DELETED_MESSAGE);
    }
    return existing;
  }

  /** The stored photo path when it is one of this user's own objects. */
  private ownPhotoPath(user: User): string | null {
    if (!user.avatar_url) return null;
    const parsed = parseProfilePhotoPath(user.avatar_url);
    return parsed?.userId === user.id ? user.avatar_url : null;
  }

  private async deletePhotosQuietly(
    userId: string,
    paths: string[],
  ): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.storageProvider.deleteFiles(PROFILES_BUCKET, paths);
    } catch (error) {
      this.logger.warn(
        `Could not delete ${paths.length} old profile photo(s) for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
