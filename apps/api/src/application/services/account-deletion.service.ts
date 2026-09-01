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
import type { Member } from '../../domain/entities/member.entity';
import { isUnsafeStoragePath } from '../../domain/utils/storage-path';
import { AnalyticsService } from './analytics.service';
import { RbacService } from './rbac.service';
import {
  REPORT_RETENTION_HOURS,
  ReportRetentionService,
} from './report-retention.service';

/**
 * Individual account deletion (spec/behavior/data-retention.md).
 *
 * Ordering is the contract, and every step is idempotent so the whole flow is
 * safely retryable until it returns success:
 *
 *  1. storage PII purge — profile photos, then the generated reports of every
 *     chapter the user belongs to. Runs first because both need the chapter
 *     memberships (and, for photos, the `avatar_url`) that the scrub destroys
 *     to locate `chapters/<chapterId>/profiles/<userId>/` folders and
 *     `chapters/<chapterId>/reports/` prefixes. A **photo** failure ABORTS the
 *     request (502): no account data has been touched (folders swept before
 *     the failure are already empty — they belonged to the requester and the
 *     retry re-covers the rest), so the client simply retries. Proceeding
 *     instead would tombstone the row and permanently strand the objects —
 *     the retry would have nothing left to enumerate. A **report** failure is
 *     logged and the flow continues; those objects have their own 24h reaper,
 *     so aborting would revoke erasure over a delay the sweep already bounds.
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
    private readonly reportRetention: ReportRetentionService,
    private readonly rbacService: RbacService,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Read once and shared with both the storage purge and the post-anonymize
    // orphan-presidency check below — `anonymize_user` hard-deletes these
    // `members` rows (step 2), so this is the last point either can see them.
    // Folded into the same try/catch as the purge itself: failing to even
    // enumerate memberships means the purge cannot know what to sweep, so it
    // is the same "nothing was touched yet, client should retry" failure mode.
    let memberships: Member[];
    try {
      memberships = await this.memberRepo.findByUser(user.id);
      await this.purgeStorageObjects(user, memberships);
    } catch (error) {
      this.logger.error(
        `Storage PII purge failed for user ${userId}; aborting before any ACCOUNT DATA was changed (objects swept before the failure are already gone) — client should retry`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadGatewayException(
        'Stored file cleanup did not complete; no account data was changed. Please retry.',
      );
    }

    const tombstone = await this.userRepo.anonymize(userId);
    if (!tombstone) throw new NotFoundException('User not found');

    // Account deletion is the other orphaning cause spec/behavior/rbac.md's
    // Presidency Transfer "Edge case" names (the first is MemberService.remove
    // via members:remove). Best-effort: erasure must complete even if this
    // bookkeeping step fails — there is no equivalent of the report sweep's
    // independent backstop for it, but blocking a right-to-erasure request on
    // a secondary side effect would be worse than a chapter briefly missing
    // its needs_president flag.
    try {
      await this.flagOrphanedPresidencies(memberships);
    } catch (error) {
      this.logger.error(
        `Failed to flag orphaned presidencies for deleted user ${userId}; a chapter this user presided over may be missing its needs_president flag — investigate manually`,
        error instanceof Error ? error.stack : String(error),
      );
    }

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

    // Final convergence scrub. The auth account is gone, so nothing can write
    // to this user again — but a PATCH may have landed between the scrub above
    // and the auth deletion (the token was still valid for those seconds, and
    // a successful run has no retry to clean it up), and a card writer that
    // raced the first scrub may have committed a snapshot just after the only
    // card scan. Re-running the scrub with a forced card rescan as the last
    // writer converges both. (The repository UPDATE additionally refuses
    // tombstones outright, catching even a write stalled past this point.)
    // Best-effort: the deletion has already met its contract, so a transient
    // failure here is logged loudly rather than failing a completed request.
    try {
      await this.userRepo.anonymize(userId, true);
    } catch (error) {
      this.logger.error(
        `Post-auth-deletion convergence scrub failed for user ${userId}; if a concurrent profile edit or card slipped in during deletion it may persist — re-run anonymize_user('${userId}', true) manually`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Every storage object holding this user's PII, purged before the scrub
   * that would destroy the memberships locating them.
   *
   * `memberships` is passed in from {@link deleteAccount} rather than read
   * here: the caller also needs the same snapshot afterward for
   * {@link flagOrphanedPresidencies}, and a second read could straddle a
   * membership change and leave the two purges (or the purge and the orphan
   * check) disagreeing on the chapter set.
   */
  private async purgeStorageObjects(
    user: User,
    memberships: Member[],
  ): Promise<void> {
    const chapterIds = memberships.map((membership) => membership.chapter_id);

    await this.purgeAvatarObjects(user, chapterIds);

    // Generated reports are chapter-scoped snapshots — a rendered PDF cannot
    // have one member removed from it — so erasure means dropping the whole
    // report prefix of every chapter this user is in. Safe because exports are
    // derived artifacts, regenerable from the source tables
    // (spec/behavior/data-retention.md).
    //
    // Best-effort, unlike the avatar purge above, and the asymmetry is the
    // point: report objects have an independent backstop and profile photos do
    // not. The hourly retention sweep deletes every export past 24h whether or
    // not this ran, so a failure here delays report erasure by at most that
    // window. Letting it abort instead would trade a bounded delay for three
    // unbounded harms — the user could never complete a right-to-erasure
    // request at all; every retry would re-run the avatar purge that already
    // succeeded, destroying their profile photos while leaving the account
    // alive; and one chapter's unlistable prefix would block deletion for every
    // member of that chapter. A storage misconfiguration must not be able to
    // revoke erasure.
    try {
      await this.reportRetention.purgeUserReports(chapterIds);
    } catch (error) {
      this.logger.error(
        `Report purge failed for user ${user.id}; deletion is proceeding; the hourly retention sweep normally removes these exports within ~${REPORT_RETENTION_HOURS + 1}h, but it cannot age out an object whose stored-at timestamp is missing and it skips a prefix it cannot read — investigate the reports bucket if this repeats`,
        error instanceof Error ? error.stack : String(error),
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
  private async purgeAvatarObjects(
    user: User,
    chapterIds: string[],
  ): Promise<void> {
    const prefixes = new Set<string>();
    for (const chapterId of chapterIds) {
      prefixes.add(profileFolderPrefix(chapterId, user.id));
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
   * Folder of the current avatar. Accepts the bucket-relative storage path
   * the upload flow issues (`chapters/<cid>/profiles/<uid>/<file>`) either
   * bare or embedded in a URL (clients may store a public/signed storage URL
   * — the object path is embedded verbatim in both forms). Anything without
   * that recognizable shape is ignored rather than guessed at.
   */
  private avatarUrlFolder(user: User): string | null {
    const value = user.avatar_url;
    if (!value) return null;
    const start = value.indexOf('chapters/');
    if (start === -1) return null;
    const path = value.slice(start);
    const marker = `/profiles/${user.id}/`;
    const markerIndex = path.indexOf(marker);
    if (markerIndex === -1) return null;
    const folder = path.slice(0, markerIndex + marker.length - 1);
    // `avatar_url` is an unvalidated free-text column, so it can carry relative
    // segments. The storage layer rejects those — and this purge runs *before*
    // anything else, converting the rejection into a permanent 502 that would
    // brick the user's own right-to-erasure request with no way to self-serve
    // out of it. An unusable folder is ignored exactly like an unrecognizable
    // one; the membership-derived prefixes above still sweep the real objects.
    if (isUnsafeStoragePath(folder)) return null;
    return folder;
  }

  /**
   * For each chapter membership this (now-anonymized) user held, flag the
   * chapter if that membership carried the President role — mirrors
   * `MemberService.remove`'s call for the manual-removal case. `actorUserId`
   * is null: account deletion has no acting member, only the system itself.
   */
  private async flagOrphanedPresidencies(memberships: Member[]): Promise<void> {
    for (const membership of memberships) {
      await this.rbacService.flagIfPresidentRemoved(
        membership.chapter_id,
        membership.role_ids,
        null,
      );
    }
  }
}
