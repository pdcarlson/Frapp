import { Module } from '@nestjs/common';
import { BirthdayPostSweepService } from '../../application/workers/birthday-post-sweep.service';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { USER_SETTINGS_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import { SupabaseChapterRepository } from '../../infrastructure/supabase/repositories/supabase-chapter.repository';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { SupabaseUserSettingsRepository } from '../../infrastructure/supabase/repositories/supabase-user-settings.repository';

/** The happy-birthday posts (#4959): the sweep and what it reads and writes. */
@Module({
  providers: [
    BirthdayPostSweepService,
    { provide: CHAPTER_REPOSITORY, useClass: SupabaseChapterRepository },
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
    {
      provide: USER_SETTINGS_REPOSITORY,
      useClass: SupabaseUserSettingsRepository,
    },
  ],
})
export class BirthdayModule {}
