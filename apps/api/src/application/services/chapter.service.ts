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
import { assertSafeStoragePath } from '../../domain/utils/storage-path';
import {
  buildChapterPalette,
  logChapterPaletteWarnings,
  type FailedContrastCheck,
} from './chapter-palette';
import {
  toChapterMemberView,
  type ChapterMemberView,
} from './chapter-member-view';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { Chapter } from '../../domain/entities/chapter.entity';
import type { Member } from '../../domain/entities/member.entity';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
  SystemRoleKeys,
} from '../../domain/constants/permissions';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';

const BRANDING_BUCKET = 'branding';
const CHANNEL_SEEDING_ERROR_MESSAGE =
  'Unable to create default chat channels for this chapter';

export interface ChapterMembershipSummary {
  member_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
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
    if (!data.accent_color) {
      return {
        chapter: await this.chapterRepo.update(id, data),
        failedContrastChecks: [],
      };
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
    const existing = await this.chapterRepo.findById(id);
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

    return { chapter, failedContrastChecks: build.failedContrastChecks };
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
      chapter: toChapterMemberView(chapter),
    };
  }
}
