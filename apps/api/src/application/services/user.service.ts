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
  ownProfilePhotoPath,
  parseProfilePhotoPath,
  profileFolderPrefix,
} from '#domain/constants/storage';
import { ProfilePhotoUrlService } from './profile-photo-url.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/**
 * How old an unconfirmed upload in a member's folder must be before a photo
 * change deletes it. A day is far past any upload a device is still about to
 * confirm, so the delete can never race one.
 */
const STRAY_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

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
    await this.requireLiveUser(id);
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
   * store a photo that renders broken on every surface.
   *
   * Then two kinds of object are deleted, best-effort:
   *
   * - the photo this one replaced, wherever it lives;
   * - uploads in this folder older than {@link STRAY_UPLOAD_AGE_MS} that were
   *   never confirmed.
   *
   * A younger unconfirmed upload is left alone, even though it is clutter,
   * because it can be another device's upload that is about to be confirmed.
   * Deleting it would fail that confirm, and when two confirms race, each
   * deleting the other's object would leave the photo pointing at nothing.
   *
   * Nothing serializes two confirms either, so the sweep never trusts the
   * `avatar_url` it read before writing. It re-reads the column after its own
   * write and spares whatever that holds: a retried confirm of the current
   * photo can land after another device's confirm and set the column back,
   * and deleting the "replaced" photo then would leave the member pointing at
   * a deleted object. `ChapterService` sweeps the logo folder the same way.
   *
   * The member's photo has already changed by the time the deletes run.
   * Whatever a failed delete leaves is still under the member's own folders,
   * which a chapter departure and an account deletion purge (#711); an upload
   * that lands after its member left the chapter is not yet covered (#2911).
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
    const stored = await this.storageProvider.listObjects(
      PROFILES_BUCKET,
      folder,
    );
    if (!stored.some((object) => object.path === storagePath)) {
      throw new BadRequestException(
        'No uploaded photo at storage_path. Upload it before confirming.',
      );
    }

    const user = await this.userRepo.update(userId, {
      avatar_url: storagePath,
    });

    let current: string | null;
    try {
      current = (await this.userRepo.findById(userId))?.avatar_url ?? null;
    } catch (error) {
      // Without knowing what is current, deleting anything could delete it.
      logThrowable(
        this.logger,
        'warn',
        `Skipped the profile photo sweep for user ${userId}: could not re-read avatar_url`,
        error,
      );
      return this.withSignedPhoto(user);
    }
    const keep = new Set([storagePath, current]);
    const staleBefore = Date.now() - STRAY_UPLOAD_AGE_MS;
    const doomed = new Set(
      stored
        .filter(
          (object) =>
            !keep.has(object.path) &&
            object.createdAt !== null &&
            object.createdAt.getTime() < staleBefore,
        )
        .map((object) => object.path),
    );
    const previous = ownProfilePhotoPath(existing.avatar_url, userId);
    if (previous && !keep.has(previous)) doomed.add(previous);
    await this.deletePhotosQuietly(userId, [...doomed]);

    return this.withSignedPhoto(user);
  }

  /** Clear the caller's profile photo and delete the object behind it. */
  async removeAvatar(userId: string): Promise<User> {
    const existing = await this.requireLiveUser(userId);
    if (!existing.avatar_url) return this.withSignedPhoto(existing);

    const user = await this.userRepo.update(userId, { avatar_url: null });
    const previous = ownProfilePhotoPath(existing.avatar_url, userId);
    if (previous) await this.deletePhotosQuietly(userId, [previous]);
    return this.withSignedPhoto(user);
  }

  /**
   * The user row, refusing a missing or tombstoned account.
   *
   * Tombstone guard: during account deletion there is a short window where
   * the auth account (and therefore the caller's token) still works after the
   * PII scrub. Without this check a profile edit landing in that window would
   * write PII back onto the anonymized row.
   */
  private async requireLiveUser(id: string): Promise<User> {
    const existing = await this.userRepo.findById(id);
    if (!existing) throw new NotFoundException('User not found');
    if (existing.deleted_at) {
      throw new GoneException(ACCOUNT_DELETED_MESSAGE);
    }
    return existing;
  }

  private async deletePhotosQuietly(
    userId: string,
    paths: string[],
  ): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.storageProvider.deleteFiles(PROFILES_BUCKET, paths);
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Could not delete ${paths.length} old profile photo(s) for user ${userId}`,
        error,
      );
    }
  }
}
