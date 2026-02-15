import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './interface/controllers/app.controller';
import { AppService } from './application/services/app.service';
import { DrizzleModule } from './infrastructure/database/drizzle.module';
import { ClerkWebhookController } from './interface/controllers/clerk-webhook.controller';
import { ClerkWebhookGuard } from './interface/guards/clerk-webhook.guard';
import { UserSyncService } from './application/services/user-sync.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './interface/filters/all-exceptions.filter';
import { LoggingInterceptor } from './interface/interceptors/logging.interceptor';

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
  providers: [
    AppService,
    ClerkWebhookGuard,
    UserSyncService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
