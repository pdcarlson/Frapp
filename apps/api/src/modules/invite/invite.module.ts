import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { InviteFunnelService } from '../../application/services/invite-funnel.service';
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
// AnalyticsModule → AnalyticsService: the invite card funnel (#5663).
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    ChapterModule,
    AuthModule,
    NotificationModule,
    ActivationModule,
    EmailModule,
    RbacModule,
    AnalyticsModule,
  ],
  controllers: [InviteController, InviteDetailsController],
  providers: [
    InviteService,
    InviteFunnelService,
    AuthSyncInterceptor,
    { provide: INVITE_REPOSITORY, useClass: SupabaseInviteRepository },
  ],
  // MemberController announces a join once the member finishes onboarding
  // (#5627).
  exports: [InviteService],
})
export class InviteModule {}
