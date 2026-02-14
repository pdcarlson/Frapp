import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './interface/controllers/app.controller';
import { AppService } from './application/services/app.service';
import { DrizzleModule } from './infrastructure/database/drizzle.module';
import { ClerkWebhookController } from './interface/controllers/clerk-webhook.controller';
import { ClerkWebhookGuard } from './interface/guards/clerk-webhook.guard';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule],
  controllers: [AppController, ClerkWebhookController],
  providers: [AppService, ClerkWebhookGuard],
})
export class AppModule {}
