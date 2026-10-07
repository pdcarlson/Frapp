import { Module } from '@nestjs/common';
import { ChapterService } from '../../application/services/chapter.service';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { ChapterController } from '../../interface/controllers/chapter.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { CHAPTER_CUSTOM_FIELD_REPOSITORY } from '#domain/repositories/chapter-custom-field.repository.interface';
import { CHAPTER_DIRECTORY_REPOSITORY } from '#domain/repositories/chapter-directory.repository.interface';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseChapterCustomFieldRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-custom-field.repository';
import { SupabaseChapterDirectoryRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-directory.repository';
import { AuthModule } from '../auth/auth.module';
import { ActivationModule } from '../activation/activation.module';
// Exports `ChapterAuditLogService`, which `ChapterService` uses to audit
// chapter-profile saves (#486). Safe to import: `ChapterConfigModule` imports
// only `ActivationModule`, so this introduces no cycle.
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';

@Module({
  imports: [AuthModule, ActivationModule, ChapterConfigModule],
  controllers: [ChapterController],
  providers: [
    AuthSyncInterceptor,
    ChapterService,
    ChapterOnboardingService,
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    // Chapter creation seeds the default channels and onboarding posts the
    // welcome message, seeds custom fields and files directory requests.
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
    {
      provide: CHAPTER_CUSTOM_FIELD_REPOSITORY,
      useClass: SupabaseChapterCustomFieldRepository,
    },
    {
      provide: CHAPTER_DIRECTORY_REPOSITORY,
      useClass: SupabaseChapterDirectoryRepository,
    },
  ],
  exports: [CHAPTER_REPOSITORY, ROLE_REPOSITORY, MEMBER_REPOSITORY],
})
export class ChapterModule {}
