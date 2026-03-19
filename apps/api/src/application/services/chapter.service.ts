import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { Chapter } from '../../domain/entities/chapter.entity';
import { checkWcagContrast } from '../../domain/utils/wcag';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
} from '../../domain/constants/permissions';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const BRANDING_BUCKET = 'branding';
const LIGHT_MODE_BACKGROUND = '#F8FAFC';

@Injectable()
export class ChapterService {
  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<Chapter> {
    const chapter = await this.chapterRepo.findById(id);
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }

  async create(
    userId: string,
    data: { name: string; university: string },
  ): Promise<Chapter> {
    const chapter = await this.chapterRepo.create(data);

    const roles = [];
    for (const roleDef of DEFAULT_SYSTEM_ROLES) {
      const role = await this.roleRepo.create({
        chapter_id: chapter.id,
        name: roleDef.name,
        permissions: [...roleDef.permissions],
        is_system: roleDef.is_system,
        display_order: roleDef.display_order,
        color: roleDef.color ?? null,
      });
      roles.push(role);
    }

    const presidentRole = roles.find((r) => r.name === 'President');
    await this.memberRepo.create({
      user_id: userId,
      chapter_id: chapter.id,
      role_ids: presidentRole ? [presidentRole.id] : [],
      has_completed_onboarding: true,
    });

    const channelsToInsert = DEFAULT_CHANNELS.map((channelDef) => ({
      chapter_id: chapter.id,
      name: channelDef.name,
      type: channelDef.type,
      is_read_only: channelDef.is_read_only,
    }));
    await this.supabase.from('chat_channels').insert(channelsToInsert);

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
    const storagePath = `chapters/${chapterId}/branding/logo.${ext}`;

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
}
