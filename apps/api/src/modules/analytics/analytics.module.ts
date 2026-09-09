import { Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AnalyticsController } from '../../interface/controllers/analytics.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import {
  ANALYTICS_PROVIDER,
  type IAnalyticsProvider,
} from '#domain/adapters/analytics.interface';
import {
  FEATURE_FLAG_PROVIDER,
  type IFeatureFlagProvider,
} from '#domain/adapters/feature-flag.interface';
import { parsePosthogConfig } from '../../infrastructure/analytics/posthog-config';
import {
  ensurePosthogRuntime,
  shutdownPosthogRuntime,
} from '../../infrastructure/analytics/posthog-runtime';
import { AuthModule } from '../auth/auth.module';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';

/** Log context for the provider-selection lines emitted by {@link selectAnalyticsProvider}. */
const ANALYTICS_PROVIDER_LOG_CONTEXT = 'AnalyticsProvider';

/**
 * Choose the analytics transport: PostHog when a valid project key is
 * configured, otherwise the no-op provider so local dev, tests, and CI run
 * without any analytics secret.
 *
 * The choice is always logged. It used to be silent, which made an environment
 * holding an `ANALYTICS_HMAC_SALT` but no `POSTHOG_API_KEY` read as fully
 * configured while every event terminated in the no-op. Named product
 * events still post to `POST /v1/analytics/events`, so this factory is the
 * API-side point where a missing or malformed `POSTHOG_API_KEY` is
 * observable. Same posture as the `Bootstrap` warning in `main.ts` — never
 * let a misconfigured environment look healthy.
 *
 * Exported (rather than inlined into the provider entry) so the selection can
 * be asserted directly, without standing up the whole module graph.
 */
export function selectAnalyticsProvider(
  config: ConfigService,
): IAnalyticsProvider {
  const parsed = parsePosthogConfig({
    POSTHOG_API_KEY: config.get<string>('POSTHOG_API_KEY'),
    POSTHOG_HOST: config.get<string>('POSTHOG_HOST'),
  });
  const runtime = ensurePosthogRuntime(config);

  if (!parsed.config) {
    const salt = config.get<string>('ANALYTICS_HMAC_SALT');
    if (
      parsed.reason === 'malformed_key' ||
      parsed.reason === 'malformed_host'
    ) {
      Logger.warn(
        `POSTHOG_API_KEY configuration is ${parsed.reason} — analytics ` +
          'events use the no-op provider. Fix the key (`phc_…`) or host.',
        ANALYTICS_PROVIDER_LOG_CONTEXT,
      );
    } else if (salt) {
      Logger.warn(
        'ANALYTICS_HMAC_SALT is set but POSTHOG_API_KEY is not — analytics ' +
          'events are keyed and then discarded by the no-op provider. Set ' +
          'POSTHOG_API_KEY to deliver them.',
        ANALYTICS_PROVIDER_LOG_CONTEXT,
      );
    } else {
      Logger.log(
        'POSTHOG_API_KEY not set — analytics events use the no-op provider.',
        ANALYTICS_PROVIDER_LOG_CONTEXT,
      );
    }
    return runtime.analytics;
  }

  Logger.log(
    `Analytics events will be sent to PostHog at ${parsed.config.host}.`,
    ANALYTICS_PROVIDER_LOG_CONTEXT,
  );
  return runtime.analytics;
}

export function selectFeatureFlagProvider(
  config: ConfigService,
): IFeatureFlagProvider {
  return ensurePosthogRuntime(config).flags;
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
    {
      provide: FEATURE_FLAG_PROVIDER,
      inject: [ConfigService],
      useFactory: selectFeatureFlagProvider,
    },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await shutdownPosthogRuntime();
  }
}
