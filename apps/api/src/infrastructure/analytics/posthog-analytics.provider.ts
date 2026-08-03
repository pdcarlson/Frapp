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
 * `capture` is best-effort: failures are logged and swallowed so a provider
 * outage can never break a product request. `forget` is NOT — it reports
 * delivery, and the account-deletion flow refuses to delete the auth account
 * until it returns true (a swallowed failure there would retain the user's
 * events forever with no way to retry). Account-deletion propagation reuses
 * the capture channel by sending a sentinel event the provider-side "deleted
 * users" automation keys off, since the management API for the deletion list
 * requires a separate personal API key out of scope here. Note the boolean
 * confirms ingestion of the sentinel only — provisioning the provider-side
 * automation that consumes it is an ops prerequisite per environment.
 */
@Injectable()
export class PosthogAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(PosthogAnalyticsProvider.name);
  private readonly apiKey: string;
  private readonly host: string;

  constructor(options: PosthogProviderOptions) {
    this.apiKey = options.apiKey;
    // `??` would keep an empty/whitespace POSTHOG_HOST; treat blank as unset.
    const host = options.host?.trim() || 'https://us.i.posthog.com';
    this.host = host.replace(/\/$/, '');
  }

  async capture(event: AnalyticsEvent): Promise<void> {
    await this.send({
      api_key: this.apiKey,
      event: event.name,
      distinct_id: event.distinctId,
      properties: event.properties ?? {},
    });
  }

  async forget(distinctId: string): Promise<boolean> {
    // Emit a sentinel event that the provider-side "deleted users" automation
    // consumes to trigger delete-all-events for this hash. The hash is the only
    // identifier involved — there is no raw user id to leak here either.
    // Unlike capture, delivery matters (see IAnalyticsProvider.forget), so the
    // acknowledgement is surfaced to the caller instead of being swallowed.
    return this.send({
      api_key: this.apiKey,
      event: 'account-deleted',
      distinct_id: distinctId,
      properties: { $process_person_profile: false },
    });
  }

  /** Returns whether the provider acknowledged the request with a 2xx. */
  private async send(payload: Record<string, unknown>): Promise<boolean> {
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
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn('PostHog capture request failed', error as Error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
