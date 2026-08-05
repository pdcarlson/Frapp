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
import { checkWcagContrast } from '../../domain/utils/wcag';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
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
const LIGHT_MODE_BACKGROUND = '#F8FAFC';
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

    const presidentRole = roles.find((r) => r.name === 'President');
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

    const defaultChannels = DEFAULT_CHANNELS.map((channelDef) => ({
      chapter_id: chapter.id,
      name: channelDef.name,
      type: channelDef.type,
      is_read_only: channelDef.is_read_only,
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
    if (data.accent_color) {
      if (!checkWcagContrast(data.accent_color, LIGHT_MODE_BACKGROUND)) {
        throw new BadRequestException(
          'accent_color does not meet WCAG AA contrast requirements (4.5:1) against the light mode background (#F8FAFC). Please choose a darker color.',
        );
      }
    }
    return this.chapterRepo.update(id, data);
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
    // satisfies it and still climbs out, and the stored value is later used to
    // read the object back. Reject relative segments the way proof paths do
    // (see ServiceEntryService.assertValidProofPath).
    if (
      storagePath
        .split('/')
        .some(
          (segment) => segment === '' || segment === '.' || segment === '..',
        )
    ) {
      throw new BadRequestException(
        'storage_path must not contain relative path segments',
      );
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
      chapter,
    };
  }
}
