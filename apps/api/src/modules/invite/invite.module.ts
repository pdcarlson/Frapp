import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { InviteController } from '../../interface/controllers/invite.controller';
import { AuthSyncGuard } from '../../interface/guards/auth-sync.guard';
import { SupabaseInviteRepository } from '../../infrastructure/supabase/repositories/supabase-invite.repository';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [ChapterModule, AuthModule, NotificationModule],
  controllers: [InviteController],
  providers: [
    InviteService,
    AuthSyncGuard,
    { provide: INVITE_REPOSITORY, useClass: SupabaseInviteRepository },
  ],
  exports: [InviteService],
})
export class InviteModule {}
