import { Module } from '@nestjs/common';
import { ClerkWebhookController } from '../../interface/controllers/clerk-webhook.controller';
import { ClerkWebhookGuard } from '../../interface/guards/clerk-webhook.guard';
import { ClerkAuthGuard } from '../../interface/guards/clerk-auth.guard';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [ClerkWebhookController],
  providers: [ClerkWebhookGuard, ClerkAuthGuard],
  exports: [ClerkWebhookGuard, ClerkAuthGuard],
})
export class AuthModule {}
