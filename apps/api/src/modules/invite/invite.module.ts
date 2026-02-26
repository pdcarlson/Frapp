import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { InviteController } from '../../interface/controllers/invite.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { SupabaseInviteRepository } from '../../infrastructure/supabase/repositories/supabase-invite.repository';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ChapterModule, AuthModule],
  controllers: [InviteController],
  providers: [
    InviteService,
    AuthSyncInterceptor,
    { provide: INVITE_REPOSITORY, useClass: SupabaseInviteRepository },
  ],
  exports: [InviteService],
})
export class InviteModule {}
