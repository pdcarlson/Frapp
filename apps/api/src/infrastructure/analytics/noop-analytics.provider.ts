import { Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEvent } from '@repo/validation';
import type { IAnalyticsProvider } from '#domain/adapters/analytics.interface';

/**
 * Fallback analytics provider used when no `POSTHOG_API_KEY` is configured
 * (e.g. local dev, tests, CI). It logs at debug level so the pipeline is
 * observable without shipping anything off-box. Never throws.
 */
@Injectable()
export class NoopAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(NoopAnalyticsProvider.name);

  // Logs only the event name, never the pseudonymous distinctId — the hash is a
  // stable per-user identifier and writing it to logs would re-introduce a
  // correlatable trail the pseudonymity is meant to avoid.
  capture(event: AnalyticsEvent): Promise<void> {
    this.logger.debug(`analytics(noop) capture ${event.name}`);
    return Promise.resolve();
  }

  forget(distinctId: string): Promise<boolean> {
    void distinctId; // intentionally not logged — see capture()
    this.logger.debug('analytics(noop) forget <redacted>');
    // Nothing was ever shipped off-box, so there is nothing to forget —
    // report success so account deletion is never blocked by the noop.
    return Promise.resolve(true);
  }
}
