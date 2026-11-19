import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { InviteController } from '../../interface/controllers/invite.controller';
import { InviteDetailsController } from '../../interface/controllers/invite-details.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { SupabaseInviteRepository } from '../../infrastructure/supabase/repositories/supabase-invite.repository';
import { INVITE_REPOSITORY } from '#domain/repositories/invite.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { ActivationModule } from '../activation/activation.module';
import { EmailModule } from '../email/email.module';
// RbacModule → RbacService: the member-joined push goes to whoever can act on
// a join (#3656).
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    ChapterModule,
    AuthModule,
    NotificationModule,
    ActivationModule,
    EmailModule,
    RbacModule,
  ],
  controllers: [InviteController, InviteDetailsController],
  providers: [
    InviteService,
    AuthSyncInterceptor,
    { provide: INVITE_REPOSITORY, useClass: SupabaseInviteRepository },
  ],
})
export class InviteModule {}
