import { Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEvent } from '@repo/validation';
import type { IAnalyticsProvider } from '../../domain/adapters/analytics.interface';

/**
 * Fallback analytics provider used when no `POSTHOG_API_KEY` is configured
 * (e.g. local dev, tests, CI). It logs at debug level so the pipeline is
 * observable without shipping anything off-box. Never throws.
 */
@Injectable()
export class NoopAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(NoopAnalyticsProvider.name);

  capture(event: AnalyticsEvent): Promise<void> {
    this.logger.debug(
      `analytics(noop) capture ${event.name} distinctId=${event.distinctId}`,
    );
    return Promise.resolve();
  }

  forget(distinctId: string): Promise<void> {
    this.logger.debug(`analytics(noop) forget distinctId=${distinctId}`);
    return Promise.resolve();
  }
}
