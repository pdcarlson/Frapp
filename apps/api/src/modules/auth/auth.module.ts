import { Module } from '@nestjs/common';
import { ClerkWebhookController } from '../../interface/controllers/clerk-webhook.controller';
import { UserSyncService } from '../../application/services/user-sync.service';
import { ClerkWebhookGuard } from '../../interface/guards/clerk-webhook.guard';
import { ClerkAuthGuard } from '../../interface/guards/clerk-auth.guard';

@Module({
  controllers: [ClerkWebhookController],
  providers: [UserSyncService, ClerkWebhookGuard, ClerkAuthGuard],
  exports: [ClerkWebhookGuard, ClerkAuthGuard, UserSyncService],
})
export class AuthModule {}
