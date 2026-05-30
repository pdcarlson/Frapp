import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AnalyticsController } from '../../interface/controllers/analytics.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { ANALYTICS_PROVIDER } from '../../domain/adapters/analytics.interface';
import { NoopAnalyticsProvider } from '../../infrastructure/analytics/noop-analytics.provider';
import { PosthogAnalyticsProvider } from '../../infrastructure/analytics/posthog-analytics.provider';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    AuthSyncInterceptor,
    AnalyticsService,
    {
      // PostHog when a key is configured; otherwise the no-op/log provider so
      // local dev, tests, and CI run without any analytics secret.
      provide: ANALYTICS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('POSTHOG_API_KEY');
        if (!apiKey) return new NoopAnalyticsProvider();
        return new PosthogAnalyticsProvider({
          apiKey,
          host: config.get<string>('POSTHOG_HOST'),
        });
      },
    },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
