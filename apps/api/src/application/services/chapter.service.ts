import * as path from 'path';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
} from '@repo/validation';
import { assertSafeStoragePath } from '#domain/utils/storage-path';
import {
  buildChapterPalette,
  logChapterPaletteWarnings,
  type FailedContrastCheck,
} from './chapter-palette';
import {
  toChapterMemberView,
  type ChapterMemberView,
} from './chapter-member-view';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { Chapter } from '#domain/entities/chapter.entity';
import type { Member } from '#domain/entities/member.entity';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
  SystemRoleKeys,
} from '#domain/constants/permissions';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';

/**
 * The core `chapters` columns `PATCH /v1/chapters/current` can write, and so
 * the exact set a profile save audits (#486).
 *
 * Kept in lockstep with `UpdateChapterDto` rather than with the `chapters`
 * table: the table has many more columns, but the ones reachable through this
 * route are what an officer can actually change from Settings. `accent_color`
 * belongs here even though it reads as branding — the accent editor posts to
 * this route, not to the config PATCH, so it is unaudited without this entry.
 *
 * An allowlist rather than `Object.keys(data)` on purpose. Audit rows are
 * member-visible, and `data` is typed `Partial<Chapter>`, so iterating whatever
 * the caller passed would mirror any future field — `subscription_status`, say —
 * into `#chapter-audit` the moment some other caller appears. The lockstep it
 * needs instead is enforced at compile time by the exhaustiveness assertion in
 * `chapter.controller.ts`, which is the layer that can see both this list and
 * the DTO.
 */
export const AUDITED_PROFILE_FIELDS = [
  'name',
  'university',
  'donation_url',
  'accent_color',
] as const satisfies readonly (keyof Chapter)[];

/**
 * Hex equality, case-folded.
 *
 * `#8B0000` and `#8b0000` are the same colour and derive a byte-identical
 * palette, but they are different strings. Chapters seeded from the directory
 * store uppercase, while `<input type="color">` always reports lowercase — so a
 * strict compare made *re-picking the same swatch* look like an edit and posted
 * a "chapter profile updated" card to the whole chapter for a no-op.
 */
function isSameAccent(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

const BRANDING_BUCKET = 'branding';
const CHANNEL_SEEDING_ERROR_MESSAGE =
  'Unable to create default chat channels for this chapter';

export interface ChapterMembershipSummary {
  member_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  /**
   * `MODULE_CATALOG` keys whose ops-setup nudge this member has dismissed in
   * this chapter (#492). Rides this summary rather than getting its own read
   * for the same reason `has_completed_onboarding` does: chat home already
   * holds the membership, and a dedicated request per session would be a
   * round trip to decide whether to render one card.
   */
  dismissed_ops_nudges: string[];
  // Projected, not the raw row: this endpoint has no billing permission, and
  // an unprojected chapter here leaked the same identifiers `/current` did
  // (#930). See `chapter-member-view.ts`.
  chapter: ChapterMemberView;
}

@Injectable()
export class ChapterService {
  private readonly logger = new Logger(ChapterService.name);

  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  /**
   * Persist the caller's active chapter so `custom_access_token_hook` can stamp
   * it into subsequent access tokens as the authoritative `active_chapter_id`
   * claim (spec/behavior/multi-tenancy.md).
   *
   * Membership is validated here because the claim becomes authoritative: a
   * chapter the caller cannot join must never reach the token. The caller must
   * refresh their session afterwards — the claim only changes when a token is
   * issued, so without a refresh the previous one stands until it expires.
   */
  async setActiveChapter(userId: string, chapterId: string): Promise<void> {
    const membership = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!membership) {
      throw new ForbiddenException('You are not a member of this chapter');
    }

    await this.userRepo.update(userId, { active_chapter_id: chapterId });
  }

  async findById(id: string): Promise<Chapter> {
    const chapter = await this.chapterRepo.findById(id);
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }

  /**
   * `findById` plus a signed URL for the chapter logo.
   *
   * The `branding` bucket is private, so `logo_path` on its own renders
   * nothing — a client has no way to sign it. Mirrors the download-URL
   * resolution in `ChapterDocumentService.findById`.
   *
   * A storage failure resolves `logo_url` to null rather than throwing: the
   * logo is decoration on a payload that also carries name, subscription
   * status, and config, and failing the whole chapter read over an
   * unreachable asset would blank the caller's entire shell.
   */
  async findByIdWithLogoUrl(
    id: string,
  ): Promise<ChapterMemberView & { logo_url: string | null }> {
    const chapter = await this.findById(id);
    return {
      // Projected rather than spread. `findById` returns `select('*')`, and
      // this is the one caller whose result reaches a member-permissioned
      // route — see `chapter-member-view.ts` (#930).
      ...toChapterMemberView(chapter),
      logo_url: await this.resolveLogoUrl(chapter),
    };
  }

  private async resolveLogoUrl(chapter: Chapter): Promise<string | null> {
    if (!chapter.logo_path) return null;

    try {
      return await this.storageProvider.getSignedDownloadUrl(
        BRANDING_BUCKET,
        chapter.logo_path,
      );
    } catch (error) {
      this.logger.warn(
        `Could not sign logo for chapter ${chapter.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async listForUser(userId: string): Promise<ChapterMembershipSummary[]> {
    const memberships = await this.memberRepo.findByUser(userId);
    if (!memberships.length) {
      return [];
    }

    const chapters = await Promise.all(
      memberships.map(async (member) => {
        const chapter = await this.chapterRepo.findById(member.chapter_id);
        return chapter ? { member, chapter } : null;
      }),
    );

    return chapters.flatMap((entry) => {
      if (!entry) {
        return [];
      }

      return [this.mapMembershipSummary(entry.member, entry.chapter)];
    });
  }

  async create(
    userId: string,
    data: { name: string; university: string; config?: Partial<Chapter> },
  ): Promise<Chapter> {
    const { name, university, config } = data;
    // `config` carries the Chunk 02 customization columns (archetype, branding,
    // enabled_modules, …) set by the onboarding flow. Legacy callers omit it.
    const chapter = await this.chapterRepo.create({
      name,
      university,
      ...(config ?? {}),
    });

    const rolesData = DEFAULT_SYSTEM_ROLES.map((roleDef) => ({
      chapter_id: chapter.id,
      name: roleDef.name,
      system_key: roleDef.system_key,
      permissions: [...roleDef.permissions],
      is_system: roleDef.is_system,
      display_order: roleDef.display_order,
      color: roleDef.color ?? null,
    }));

    const roles = await this.roleRepo.createMany(rolesData);

    if (!roles || roles.length === 0) {
      this.logger.error(
        `Failed to create default roles for chapter ${chapter.id}`,
      );
      throw new InternalServerErrorException('Failed to create default roles');
    }

    const presidentRole = roles.find(
      (r) => r.system_key === SystemRoleKeys.PRESIDENT,
    );
    if (!presidentRole) {
      this.logger.error(
        `President role missing after default role creation for chapter ${chapter.id}`,
      );
      throw new InternalServerErrorException(
        'President role not found during chapter creation',
      );
    }
    await this.memberRepo.create({
      user_id: userId,
      chapter_id: chapter.id,
      role_ids: presidentRole ? [presidentRole.id] : [],
      has_completed_onboarding: true,
    });

    // `required_permissions` must be persisted, not defaulted: a ROLE_GATED
    // channel seeded without one is denied by `canAccessChannel`, and before
    // that gate closed it fell open to every chapter member instead (FRA-321).
    const defaultChannels: TablesInsert<'chat_channels'>[] =
      DEFAULT_CHANNELS.map((channelDef) => ({
        chapter_id: chapter.id,
        name: channelDef.name,
        type: channelDef.type,
        is_read_only: channelDef.is_read_only,
        required_permissions: channelDef.required_permissions
          ? [...channelDef.required_permissions]
          : null,
      }));

    const { error } = await this.supabase
      .from('chat_channels')
      .insert(defaultChannels);

    if (error) {
      this.logger.error(
        `Failed to insert default chat channels for chapter ${chapter.id}`,
        error.message,
      );
      throw new InternalServerErrorException(CHANNEL_SEEDING_ERROR_MESSAGE);
    }

    return chapter;
  }

  async update(
    id: string,
    data: Partial<Chapter>,
    /**
     * The member saving the form. Required rather than optional: this route is
     * only ever reached by an authenticated officer, and an audit row whose
     * actor defaulted to `null` would be indistinguishable from a genuine
     * system write (`ChapterAuditLogService`'s `actorUserId` contract).
     */
    actorUserId: string,
  ): Promise<{
    chapter: Chapter;
    /**
     * Signet §8 text-contrast checks that came back below AA for this save's
     * generated accent, or empty. Empty in effectively every real case — the
     * generator's text roles are contrast-correct by construction for the
     * whole directory-seed corpus and every hue this repo has sampled — but an
     * officer can enter arbitrary hex, and the guarantee is by construction,
     * not by proof (#1183). The save still succeeds either way: §8 forbids a
     * runtime substitution here, this is disclosure, not correction.
     */
    failedContrastChecks: FailedContrastCheck[];
  }> {
    // Read once, up front, on every path — not only the accent path, which is
    // the only one that used to need it. The audit diff (#486) has to compare
    // against the stored row to tell a real edit from a re-save, and the
    // accent branch below then reuses this same read rather than issuing a
    // second one.
    const existing = await this.chapterRepo.findById(id);

    if (!data.accent_color) {
      const chapter = await this.chapterRepo.update(id, data);
      await this.recordProfileAudit(id, actorUserId, existing, data);
      return { chapter, failedContrastChecks: [] };
    }

    // No contrast gate here any more, and its removal is the point rather than
    // an oversight. `accent_color` is now a mirror of `branding.colors.accent`,
    // which is deliberately not contrast-gated (spec/behavior/branding.md): it
    // is the accent engine's seed, and gating it would reject 49 of the 50 real
    // chapters in the directory seed.
    //
    // Keeping the gate on only this path made the column reachable in a state
    // it then refused to accept: onboarding, the config PATCH, and the backfill
    // all write it without checking, so a chapter created with a light gold
    // could never re-save its own accent from Settings — the form resends the
    // stored value and got a 400 telling the officer to pick a darker color
    // they had never picked. One value cannot have two different validities
    // depending on which door it came through.
    //
    // Legibility is still guaranteed where it matters: `resolveChapterAccentColor`
    // re-validates per surface at render time and substitutes an accessible
    // fallback, so an illegible stored accent is never actually painted.

    // `branding.colors.accent` is the authoritative accent (#795) and this
    // column mirrors it, so a Settings edit — the one path that writes the
    // column directly — has to carry the value back the other way. Without
    // this the two stores diverge the moment anyone touches Settings, which is
    // exactly how the original bug presented.
    const branding = (existing?.branding ?? {}) as {
      colors?: Record<string, string>;
    };
    // Spread first so every other stored key survives — including a legacy
    // `dark` written before the #920 slice-9 cutover removed the second brand
    // colour. Those values are inert (nothing reads them) but they are the
    // tenant's stored data, so an accent save preserves rather than prunes them.
    const colors: Record<string, string> = {
      ...(branding.colors ?? {}),
      accent: data.accent_color,
    };

    // Recompute the palette on the same write that changes the accent.
    //
    // This is the only door the accent editor uses — Settings sends
    // `PATCH /v1/chapters/current { accent_color }`, not the config PATCH — so
    // without this `theme_palette` stays frozen at whatever onboarding derived.
    // That was survivable while every client re-derived the accent from
    // `accent_color` itself, and stopped being survivable the moment a client
    // started reading the generated scale: mobile would paint the wizard's
    // original colour forever, with no in-product way to change it.
    //
    // `buildChapterPalette` never throws and always yields at least the Signet
    // map, so this cannot turn a legitimate accent save into a failed request.
    const build = buildChapterPalette({ accent: colors.accent });
    logChapterPaletteWarnings(this.logger, id, data.accent_color, build);

    const chapter = await this.chapterRepo.update(id, {
      ...data,
      branding: { ...branding, colors },
      theme_palette: build.palette,
    });

    // The branding mirror is a second, independent change this same request
    // makes, and it does not always move with the column: a chapter carrying
    // the #795 divergence has `branding.colors.accent` different from
    // `accent_color`, so re-saving the stored column value still repaints every
    // branded surface. Recorded explicitly so that save is not invisible.
    // Only when the mirror already held a value AND it moved. `chapters.branding`
    // is `jsonb not null default '{}'`, and the #795 backfill only touched rows
    // whose `branding->'colors'->>'accent'` was already non-null — so a chapter
    // that never went through an onboarding branding step has `accent_color` set
    // and `branding = {}`. Treating that absent mirror as a change would fire on
    // *every* accent save for those chapters, re-opening the very no-op card the
    // case-fold fix above closes. Populating the mirror for the first time is
    // the system catching up, not an edit the officer made.
    const previousBrandingAccent = branding.colors?.accent ?? null;
    const brandingAccentChanged =
      previousBrandingAccent !== null &&
      !isSameAccent(previousBrandingAccent, colors.accent);

    await this.recordProfileAudit(
      id,
      actorUserId,
      existing,
      data,
      brandingAccentChanged
        ? {
            'branding.colors.accent': {
              from: previousBrandingAccent,
              to: colors.accent,
            },
          }
        : undefined,
    );

    return { chapter, failedContrastChecks: build.failedContrastChecks };
  }

  /**
   * Audit a Settings → Organization → "Chapter profile" save (#486).
   *
   * Chunk 06 routes the four core `chapters` columns through this service
   * while archetype/vocabulary/branding go through `PATCH /chapters/:id/config`,
   * which has always written a `chapter_audit_log` row. That left the 06 brief's
   * "saving any Org field writes one audit row" true of config-backed fields
   * only. This closes the gap on the other door.
   *
   * Written *after* the update lands, so a save that fails leaves no audit row
   * claiming it happened. The inverse — the row failing after a successful
   * update — surfaces as a 500 rather than being swallowed, matching the other
   * writers' convention that an audit failure is never quietly dropped.
   *
   * That ordering has a known residue, recorded rather than glossed (#1599):
   * the update is already committed when the insert fails, so the officer sees
   * a 500 for a save that persisted, and retrying the identical form now
   * produces an empty diff and writes nothing. The change stays unaudited.
   * Closing it needs the row and the update in one transaction, which is not
   * reachable through PostgREST from here. `chapter-config.service.ts` has the
   * same hole — it early-returns before its insert when nothing changed
   * (`chapter-config.service.ts:400-407`) — so no writer in this codebase
   * actually guarantees "never silently unaudited", and the specs should not
   * be read as promising it.
   *
   * `ChatBridgeWorkerService` mirrors member-visible rows into `#chapter-audit`
   * off a Realtime subscription, so there is no chat call to make here.
   */
  private async recordProfileAudit(
    chapterId: string,
    actorUserId: string,
    existing: Chapter | null,
    data: Partial<Chapter>,
    /**
     * Changes the caller detected that are not plain column comparisons — today
     * only `branding.colors.accent`, which the accent path rewrites from the
     * same request. Without it a save that repairs a legacy
     * `accent_color` ≠ `branding.colors.accent` divergence (#795) repaints every
     * branded surface in the chapter while the column itself is unchanged, and
     * would produce no audit row at all.
     */
    extra?: Record<string, { from: unknown; to: unknown }>,
  ): Promise<void> {
    // No stored row to diff against means no honest `from` value. The update
    // itself will have thrown for a genuinely missing chapter, so this is
    // defensive rather than a reachable state.
    if (!existing) return;

    const diff: Record<string, { from: unknown; to: unknown }> = {
      ...(extra ?? {}),
    };

    for (const field of AUDITED_PROFILE_FIELDS) {
      const next = data[field];
      if (next === undefined) continue;
      const previous = existing[field];
      if (
        field === 'accent_color'
          ? isSameAccent(previous ?? null, next ?? null)
          : next === previous
      ) {
        continue;
      }
      diff[field] = { from: previous, to: next };
    }

    // Not written when nothing changed. The Settings form re-sends every stored
    // value on save (see the accent_color note above), so without this an
    // officer who opened Settings and pressed Save without editing would mirror
    // a "chapter profile updated" message into the member-visible
    // `#chapter-audit` channel — and one carrying no information, since
    // `ChatBridgeWorkerService.summarize` renders an empty diff as a bare
    // action name.
    //
    // Stated about this writer only, deliberately. Two earlier attempts at this
    // comment characterised `chapter-config.service.ts` and got it wrong both
    // times — it is neither "unconditional" nor the same rule. Its early return
    // (`chapter-config.service.ts:400-406`) is gated on an empty *update
    // payload*, not an empty diff, so it still writes a `from`-equals-`to` row
    // for any jsonb field a client re-sends unchanged (#1605). Do not
    // re-describe it here without reading it.
    if (Object.keys(diff).length === 0) return;

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_profile_updated',
      targetType: 'chapter',
      targetId: chapterId,
      diff,
      memberVisible: true,
    });
  }

  async requestLogoUploadUrl(
    chapterId: string,
    filename: string,
    contentType: string,
  ): Promise<{ signedUrl: string; storage_path: string }> {
    const ext = filename.includes('.')
      ? (filename.split('.').pop()?.toLowerCase() ?? 'png')
      : 'png';

    if (!isAllowedUploadMime('image', contentType)) {
      throw new BadRequestException(
        'Invalid content type. Only images are allowed.',
      );
    }

    if (!isAllowedUploadExtension('image', ext)) {
      throw new BadRequestException(
        'Invalid file extension. Only image files are allowed.',
      );
    }

    const storagePath = `chapters/${chapterId}/branding/logo.${path.basename(ext)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      BRANDING_BUCKET,
      storagePath,
      contentType,
    );

    return { signedUrl, storage_path: storagePath };
  }

  async confirmLogoUpload(
    chapterId: string,
    storagePath: string,
  ): Promise<Chapter> {
    if (!storagePath.startsWith(`chapters/${chapterId}/branding/`)) {
      throw new BadRequestException(
        'storage_path must be within the chapter branding folder',
      );
    }
    // A prefix check alone is not containment: `chapters/<id>/branding/../../..`
    // satisfies it and still climbs out, and the stored value is later read back
    // to embed the logo in exported PDFs. Percent-encoded dot segments count —
    // see assertSafeStoragePath for why.
    //
    // `assertSafeStoragePath` is domain-layer code and throws a plain `Error`;
    // this catch is what turns that into the `BadRequestException` (400) API
    // consumers have always seen on an unsafe path.
    try {
      assertSafeStoragePath(
        storagePath,
        'storage_path must not contain relative path segments',
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.chapterRepo.update(chapterId, { logo_path: storagePath });
  }

  async deleteLogo(chapterId: string): Promise<Chapter> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) throw new NotFoundException('Chapter not found');
    if (chapter.logo_path) {
      await this.storageProvider.deleteFile(BRANDING_BUCKET, chapter.logo_path);
    }
    return this.chapterRepo.update(chapterId, { logo_path: null });
  }

  private mapMembershipSummary(
    member: Member,
    chapter: Chapter,
  ): ChapterMembershipSummary {
    return {
      member_id: member.id,
      chapter_id: member.chapter_id,
      role_ids: member.role_ids,
      has_completed_onboarding: member.has_completed_onboarding,
      // `?? []` because the column was added after these rows existed: a member
      // row read back by a client older than the migration, or from a test
      // fixture that predates it, has no key here. The web contract declares a
      // plain array, so normalizing at the boundary keeps `undefined` from
      // reaching `selectOpsNudge`.
      dismissed_ops_nudges: member.dismissed_ops_nudges ?? [],
      chapter: toChapterMemberView(chapter),
    };
  }
}
