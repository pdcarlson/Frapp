import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './interface/controllers/app.controller';
import { AppService } from './application/services/app.service';
import { DrizzleModule } from './infrastructure/database/drizzle.module';
import { ClerkWebhookController } from './interface/controllers/clerk-webhook.controller';
import { ClerkWebhookGuard } from './interface/guards/clerk-webhook.guard';
import { UserSyncService } from './application/services/user-sync.service';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
  ],
  controllers: [AppController, ClerkWebhookController],
  providers: [AppService, ClerkWebhookGuard, UserSyncService],
})
export class AppModule {}
