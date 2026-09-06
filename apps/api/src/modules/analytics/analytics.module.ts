import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AnalyticsController } from '../../interface/controllers/analytics.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import {
  ANALYTICS_PROVIDER,
  type IAnalyticsProvider,
} from '#domain/adapters/analytics.interface';
import { NoopAnalyticsProvider } from '../../infrastructure/analytics/noop-analytics.provider';
import {
  PosthogAnalyticsProvider,
  resolvePosthogHost,
} from '../../infrastructure/analytics/posthog-analytics.provider';
import { AuthModule } from '../auth/auth.module';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';

/** Log context for the provider-selection lines emitted by {@link selectAnalyticsProvider}. */
const ANALYTICS_PROVIDER_LOG_CONTEXT = 'AnalyticsProvider';

/**
 * Choose the analytics transport: PostHog when a key is configured, otherwise
 * the no-op provider so local dev, tests, and CI run without any analytics
 * secret.
 *
 * The choice is always logged. It used to be silent, which made an environment
 * holding an `ANALYTICS_HMAC_SALT` but no `POSTHOG_API_KEY` read as fully
 * configured while every event terminated in the no-op. Nothing downstream can
 * reveal that: the API is the only analytics transport (clients post to
 * `POST /v1/analytics/events` rather than carrying a provider SDK), so this
 * function is the single point where the distinction is observable. Same
 * posture as the `Bootstrap` warning in `main.ts` — never let a misconfigured
 * environment look healthy.
 *
 * Exported (rather than inlined into the provider entry) so the selection can
 * be asserted directly, without standing up the whole module graph.
 */
export function selectAnalyticsProvider(
  config: ConfigService,
): IAnalyticsProvider {
  const apiKey = config.get<string>('POSTHOG_API_KEY');

  if (!apiKey) {
    if (config.get<string>('ANALYTICS_HMAC_SALT')) {
      // Salt set, key absent: events are pseudonymized and then dropped. That
      // is a misconfiguration in a deployed environment, not a resting state,
      // so it warns.
      Logger.warn(
        'ANALYTICS_HMAC_SALT is set but POSTHOG_API_KEY is not — analytics ' +
          'events are keyed and then discarded by the no-op provider. Set ' +
          'POSTHOG_API_KEY to deliver them.',
        ANALYTICS_PROVIDER_LOG_CONTEXT,
      );
    } else {
      // Neither set: the intended local / test / CI state. Logged so the
      // selection is visible, but at `log` level — nothing is wrong.
      Logger.log(
        'POSTHOG_API_KEY not set — analytics events use the no-op provider.',
        ANALYTICS_PROVIDER_LOG_CONTEXT,
      );
    }
    return new NoopAnalyticsProvider();
  }

  const host = config.get<string>('POSTHOG_HOST');
  Logger.log(
    `Analytics events will be sent to PostHog at ${resolvePosthogHost(host)}.`,
    ANALYTICS_PROVIDER_LOG_CONTEXT,
  );
  return new PosthogAnalyticsProvider({ apiKey, host });
}

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
      provide: ANALYTICS_PROVIDER,
      inject: [ConfigService],
      useFactory: selectAnalyticsProvider,
    },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
