import { Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEvent } from '@repo/validation';
import type { IAnalyticsProvider } from '../../domain/adapters/analytics.interface';

export interface PosthogProviderOptions {
  apiKey: string;
  /** Defaults to PostHog Cloud US. Override for self-host / EU. */
  host?: string;
}

/**
 * PostHog transport over the public capture API using the global `fetch`
 * (Node 18+). Events are already pseudonymous (`distinctId` is the HMAC hash),
 * so no PostHog `$identify` is ever sent and no person properties are attached.
 *
 * All network work is best-effort: failures are logged and swallowed so a
 * provider outage can never break a product request. Account-deletion
 * propagation reuses the capture channel by sending a sentinel event the
 * provider's "deleted users" automation keys off, since the management API for
 * the deletion list requires a separate personal API key out of scope here.
 */
@Injectable()
export class PosthogAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(PosthogAnalyticsProvider.name);
  private readonly apiKey: string;
  private readonly host: string;

  constructor(options: PosthogProviderOptions) {
    this.apiKey = options.apiKey;
    this.host = (options.host ?? 'https://us.i.posthog.com').replace(/\/$/, '');
  }

  async capture(event: AnalyticsEvent): Promise<void> {
    await this.send({
      api_key: this.apiKey,
      event: event.name,
      distinct_id: event.distinctId,
      properties: event.properties ?? {},
    });
  }

  async forget(distinctId: string): Promise<void> {
    // Emit a sentinel event that the provider-side "deleted users" automation
    // consumes to trigger delete-all-events for this hash. The hash is the only
    // identifier involved — there is no raw user id to leak here either.
    await this.send({
      api_key: this.apiKey,
      event: 'account-deleted',
      distinct_id: distinctId,
      properties: { $process_person_profile: false },
    });
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    // Bound the request so a stalled provider (DNS hang, slow POP) can't pile
    // up pending promises on the API event loop.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${this.host}/capture/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `PostHog capture returned ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      this.logger.warn('PostHog capture request failed', error as Error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
