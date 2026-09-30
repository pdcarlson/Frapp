import { Module } from '@nestjs/common';
import { MemberService } from '../../application/services/member.service';
import { MemberController } from '../../interface/controllers/member.controller';
import { AlumniController } from '../../interface/controllers/alumni.controller';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';
import { RbacModule } from '../rbac/rbac.module';
import { ChannelCacheModule } from '../chat-push-worker/channel-cache.module';
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
