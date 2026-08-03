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
import { AnalyticsService } from './analytics.service';

const PROFILES_BUCKET = 'profiles';

/**
 * Individual account deletion (spec/behavior/data-retention.md).
 *
 * Ordering is the contract:
 *
 *  1. avatar/profile-photo storage purge — runs first because it needs the
 *     chapter memberships the scrub deletes to locate
 *     `chapters/<chapterId>/profiles/<userId>/` prefixes. Best-effort: a
 *     storage failure is logged and skipped, never blocks the privacy
 *     deletion (objects sit behind non-guessable service-role-only paths).
 *  2. `anonymize_user` RPC — the authoritative, atomic, idempotent step:
 *     tombstones the users row ("Deleted User" + sentinel email), purges
 *     current-state rows, scrubs card name snapshots. History (points,
 *     attendance, chat, service entries) is preserved anonymized.
 *  3. analytics forget — adds the pseudonym to the provider's deleted-users
 *     list (fire-and-forget semantics inside AnalyticsService).
 *  4. Supabase Auth deletion — deliberately LAST, only after the database
 *     state is safe. On failure the caller's token is still valid (the auth
 *     account still exists), so the client simply retries DELETE /v1/users/me:
 *     steps 1–3 are no-ops/idempotent on a tombstone and step 4 re-runs.
 *     Once it succeeds the token dies with the account (SupabaseAuthGuard
 *     validates server-side) and sign-in is permanently gone — irreversible,
 *     as the spec requires.
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

    // A tombstone means a previous run already purged memberships, so there
    // are no prefixes left to enumerate — the original run already swept them.
    if (!user.deleted_at) {
      await this.purgeAvatarObjects(userId);
    }

    const tombstone = await this.userRepo.anonymize(userId);
    if (!tombstone) throw new NotFoundException('User not found');

    await this.analytics.forgetUser(userId);

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

  private async purgeAvatarObjects(userId: string): Promise<void> {
    let memberships;
    try {
      memberships = await this.memberRepo.findByUser(userId);
    } catch (error) {
      this.logger.warn(
        `Could not enumerate memberships for avatar purge (user ${userId}); continuing with deletion`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    for (const membership of memberships) {
      const prefix = `chapters/${membership.chapter_id}/profiles/${userId}`;
      try {
        const paths = await this.storageProvider.listFiles(
          PROFILES_BUCKET,
          prefix,
        );
        for (const path of paths) {
          await this.storageProvider.deleteFile(PROFILES_BUCKET, path);
        }
      } catch (error) {
        this.logger.warn(
          `Avatar purge failed under ${prefix}; continuing with deletion`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
