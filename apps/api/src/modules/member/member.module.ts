import { Module } from '@nestjs/common';
import { MemberService } from '../../application/services/member.service';
import { MemberPhoneReachService } from '../../application/services/member-phone-reach.service';
import { PUSH_TOKEN_REPOSITORY } from '#domain/repositories/notification.repository.interface';
import { SupabasePushTokenRepository } from '../../infrastructure/supabase/repositories/supabase-push-token.repository';
import { MemberController } from '../../interface/controllers/member.controller';
import { AlumniController } from '../../interface/controllers/alumni.controller';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';
import { RbacModule } from '../rbac/rbac.module';
import { ChannelCacheModule } from '../channel-cache/channel-cache.module';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { SupabaseChatChannelRepository } from '../../infrastructure/supabase/repositories/supabase-chat-channel.repository';
import { ProfilePhotoModule } from '../profile-photo/profile-photo.module';

@Module({
  imports: [
    ChapterModule,
    AuthModule,
    ChapterConfigModule,
    RbacModule,
    // `MemberService.remove` evicts the channels it prunes (#1302).
    ChannelCacheModule,
    ProfilePhotoModule,
  ],
  controllers: [MemberController, AlumniController],
  providers: [
    MemberService,
    // The Directory's "Phone app" filter reads each member's push tokens.
    MemberPhoneReachService,
    { provide: PUSH_TOKEN_REPOSITORY, useClass: SupabasePushTokenRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    // `MemberService.remove` takes a departing member off the chapter's
    // PRIVATE channels (#1302).
    {
      provide: CHAT_CHANNEL_REPOSITORY,
      useClass: SupabaseChatChannelRepository,
    },
  ],
  exports: [MemberService],
})
export class MemberModule {}
