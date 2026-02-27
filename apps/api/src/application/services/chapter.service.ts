import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { Chapter } from '../../domain/entities/chapter.entity';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
} from '../../domain/constants/permissions';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

@Injectable()
export class ChapterService {
  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
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

    for (const channelDef of DEFAULT_CHANNELS) {
      await this.supabase.from('chat_channels').insert({
        chapter_id: chapter.id,
        name: channelDef.name,
        type: channelDef.type,
        is_read_only: channelDef.is_read_only,
      });
    }

    return chapter;
  }

  async update(id: string, data: Partial<Chapter>): Promise<Chapter> {
    return this.chapterRepo.update(id, data);
  }
}
