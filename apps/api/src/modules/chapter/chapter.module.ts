import { Module } from '@nestjs/common';
import { ChapterService } from '../../application/services/chapter.service';
import { ChapterController } from '../../interface/controllers/chapter.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ChapterController],
  providers: [
    AuthSyncInterceptor,
    ChapterService,
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [
    ChapterService,
    CHAPTER_REPOSITORY,
    ROLE_REPOSITORY,
    MEMBER_REPOSITORY,
  ],
})
export class ChapterModule {}
