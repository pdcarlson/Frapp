import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { InviteController } from '../../interface/controllers/invite.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { SupabaseInviteRepository } from '../../infrastructure/supabase/repositories/supabase-invite.repository';
import { INVITE_REPOSITORY } from '#domain/repositories/invite.repository.interface';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import { SupabaseChatMessageRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message.repository';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { ActivationModule } from '../activation/activation.module';
import { EmailModule } from '../email/email.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    ChapterModule,
    AuthModule,
    NotificationModule,
    ActivationModule,
    EmailModule,
    ChatModule,
  ],
  controllers: [InviteController],
  providers: [
    InviteService,
    AuthSyncInterceptor,
    { provide: INVITE_REPOSITORY, useClass: SupabaseInviteRepository },
    // The accept-notice DM. Provided directly: ChatModule exports only its
    // services, and the repository is a stateless wrapper over the shared
    // client, so a second instance costs nothing.
    {
      provide: CHAT_MESSAGE_REPOSITORY,
      useClass: SupabaseChatMessageRepository,
    },
  ],
})
export class InviteModule {}
