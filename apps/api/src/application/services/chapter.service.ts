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
import { assertSafeStoragePath } from '../../domain/utils/storage-path';
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
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const BRANDING_BUCKET = 'branding';
const ALLOWED_LOGO_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const ALLOWED_LOGO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const CHANNEL_SEEDING_ERROR_MESSAGE =
  'Unable to create default chat channels for this chapter';

export interface ChapterMembershipSummary {
  member_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  chapter: Chapter;
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
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
  ): Promise<Chapter & { logo_url: string | null }> {
    const chapter = await this.findById(id);
    return { ...chapter, logo_url: await this.resolveLogoUrl(chapter) };
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
    const defaultChannels = DEFAULT_CHANNELS.map((channelDef) => ({
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

  async update(id: string, data: Partial<Chapter>): Promise<Chapter> {
    if (!data.accent_color) {
      return this.chapterRepo.update(id, data);
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

    return this.chapterRepo.update(id, {
      ...data,
      branding: {
        ...branding,
        colors: { ...(branding.colors ?? {}), accent: data.accent_color },
      },
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

    if (!ALLOWED_LOGO_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        'Invalid content type. Only images are allowed.',
      );
    }

    if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
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
    assertSafeStoragePath(
      storagePath,
      'storage_path must not contain relative path segments',
    );
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
      chapter,
    };
  }
}
