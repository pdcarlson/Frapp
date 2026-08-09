import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AnalyticsController } from '../../interface/controllers/analytics.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { ANALYTICS_PROVIDER } from '../../domain/adapters/analytics.interface';
import { NoopAnalyticsProvider } from '../../infrastructure/analytics/noop-analytics.provider';
import { PosthogAnalyticsProvider } from '../../infrastructure/analytics/posthog-analytics.provider';
import { AuthModule } from '../auth/auth.module';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';

@Module({
  // MEMBER_REPOSITORY is provided directly rather than by importing
  // ChapterModule (which also exports it, and which this module used to
  // import). ChapterModule now depends on ActivationModule for the onboarding
  // milestone (#267), and ActivationModule depends on this one — importing
  // ChapterModule here would close that loop into a cycle. Providing the
  // repository directly is the same pattern BillingModule already uses, and
  // these Supabase repositories are stateless wrappers over the shared client,
  // so a second instance costs nothing.
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    AuthSyncInterceptor,
    AnalyticsService,
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
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
