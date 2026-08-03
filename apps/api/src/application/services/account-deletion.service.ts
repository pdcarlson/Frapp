import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import {
  AUTH_ADMIN_PROVIDER,
  type IAuthAdminProvider,
} from '../../domain/adapters/auth-admin.interface';
import {
  PROFILES_BUCKET,
  profileFolderPrefix,
} from '../../domain/constants/storage';
import type { User } from '../../domain/entities/user.entity';
import { AnalyticsService } from './analytics.service';

/**
 * Individual account deletion (spec/behavior/data-retention.md).
 *
 * Ordering is the contract, and every step is idempotent so the whole flow is
 * safely retryable until it returns success:
 *
 *  1. avatar/profile-photo storage purge — runs first because it needs the
 *     chapter memberships and `avatar_url` the scrub destroys to locate
 *     `chapters/<chapterId>/profiles/<userId>/` folders. A failure here
 *     ABORTS the request (502): nothing has been mutated yet, so the client
 *     simply retries. Proceeding instead would tombstone the row and
 *     permanently strand the objects — the retry would have nothing left to
 *     enumerate.
 *  2. `anonymize_user` RPC — the authoritative, atomic step: tombstones the
 *     users row ("Deleted User" + sentinel email), purges current-state rows,
 *     scrubs card name snapshots in payload and content. It re-runs the full
 *     scrub on every call, so PII written onto the tombstone during a retry
 *     window is re-scrubbed. History (points, attendance, chat, service
 *     entries) is preserved anonymized.
 *  3. analytics forget — must be CONFIRMED (not fire-and-forget) before the
 *     next step, because once the auth account dies the user can never
 *     re-trigger it; an unconfirmed forget aborts with 502 and the client
 *     retries.
 *  4. Supabase Auth deletion — deliberately LAST, only after every other
 *     effect is in place. On failure the caller's token is still valid (the
 *     auth account still exists), so the client retries. Once it succeeds the
 *     token dies with the account and sign-in is permanently gone —
 *     irreversible, as the spec requires.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    @Inject(AUTH_ADMIN_PROVIDER)
    private readonly authAdmin: IAuthAdminProvider,
    private readonly analytics: AnalyticsService,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    try {
      await this.purgeAvatarObjects(user);
    } catch (error) {
      this.logger.error(
        `Avatar storage purge failed for user ${userId}; aborting before any data was changed — client should retry`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadGatewayException(
        'Profile media cleanup failed; nothing was deleted. Please retry.',
      );
    }

    const tombstone = await this.userRepo.anonymize(userId);
    if (!tombstone) throw new NotFoundException('User not found');

    const forgotten = await this.analytics.forgetUser(userId);
    if (!forgotten) {
      throw new BadGatewayException(
        'Account data was anonymized but analytics deletion could not be confirmed. Please retry.',
      );
    }

    try {
      await this.authAdmin.deleteAuthUser(tombstone.supabase_auth_id);
    } catch (error) {
      this.logger.error(
        `Supabase Auth deletion failed for user ${userId}; database is already anonymized — client should retry`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadGatewayException(
        'Account data was anonymized but the sign-in account could not be deleted. Please retry.',
      );
    }
  }

  /**
   * Delete every profile-photo object the flow can locate: one folder per
   * current chapter membership, plus the folder derived from `avatar_url` —
   * the live avatar may sit under a chapter the user has since left, which
   * memberships alone would miss. On a retry after the scrub, memberships and
   * avatar_url are gone and this is a no-op — reachable only because the
   * original run's purge already succeeded (a failed purge aborts before the
   * scrub).
   */
  private async purgeAvatarObjects(user: User): Promise<void> {
    const prefixes = new Set<string>();
    const memberships = await this.memberRepo.findByUser(user.id);
    for (const membership of memberships) {
      prefixes.add(profileFolderPrefix(membership.chapter_id, user.id));
    }
    const avatarFolder = this.avatarUrlFolder(user);
    if (avatarFolder) prefixes.add(avatarFolder);

    for (const prefix of prefixes) {
      const paths = await this.storageProvider.listFiles(
        PROFILES_BUCKET,
        prefix,
      );
      if (paths.length > 0) {
        await this.storageProvider.deleteFiles(PROFILES_BUCKET, paths);
      }
    }
  }

  /**
   * Folder of the current avatar, accepted only in the exact storage-path
   * shape the upload flow issues (`chapters/<cid>/profiles/<uid>/<file>`).
   * Anything else — absolute URLs, foreign paths — is ignored rather than
   * guessed at.
   */
  private avatarUrlFolder(user: User): string | null {
    const path = user.avatar_url;
    if (!path || !path.startsWith('chapters/')) return null;
    const marker = `/profiles/${user.id}/`;
    const markerIndex = path.indexOf(marker);
    if (markerIndex === -1) return null;
    return path.slice(0, markerIndex + marker.length - 1);
  }
}
