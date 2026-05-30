import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  assertContentFreeProperties,
  hashUserIdForAnalytics,
  type AnalyticsProperties,
} from '@repo/validation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  ANALYTICS_PROVIDER,
  type IAnalyticsProvider,
} from '../../domain/adapters/analytics.interface';

export interface TrackOptions {
  /**
   * Chapter the event is attributed to. Required so the per-chapter opt-out can
   * be enforced server-side; events with no chapter context are not gated.
   */
  chapterId?: string;
  properties?: AnalyticsProperties;
}

/**
 * Server-side half of the pseudonymous analytics pipeline (issue #464).
 *
 * Responsibilities:
 *  - Derive the pseudonymous `distinctId` via HMAC(salt, userId) — the raw
 *    userId never reaches the provider, and the salt never leaves the server.
 *  - Enforce that event payloads describe behavior, not content/PII.
 *  - Enforce the per-chapter opt-out as defense in depth before any
 *    server-originated event is sent.
 *  - Propagate account deletion to the provider's "deleted users" list.
 *
 * Canonical behavior: `spec/behavior/data-retention.md`
 * (#analytics-events-pseudonymous).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly salt: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(ANALYTICS_PROVIDER) private readonly provider: IAnalyticsProvider,
  ) {
    // Optional: when unset, the keying salt is empty and tracking is disabled
    // (the no-op provider is wired in that case too). getOrThrow is avoided so
    // local/test boots don't require analytics secrets.
    this.salt = this.config.get<string>('ANALYTICS_HMAC_SALT') ?? '';
    if (!this.salt) {
      this.logger.warn(
        'ANALYTICS_HMAC_SALT not set — server analytics events are disabled',
      );
    }
  }

  /**
   * Pseudonymous key for a user. The client uses this to attribute its own
   * events without ever holding the salt. Returns `null` when analytics is not
   * configured.
   */
  getDistinctId(userId: string): string | null {
    if (!this.salt) return null;
    return hashUserIdForAnalytics(this.salt, userId);
  }

  /**
   * Record a server-originated behavioral event. Best-effort: a provider or
   * opt-out lookup failure is logged and swallowed so product requests are
   * never affected. A *content/PII* payload, by contrast, throws — that is a
   * programming error the author must fix, caught at the boundary.
   */
  async track(
    eventName: string,
    userId: string,
    options: TrackOptions = {},
  ): Promise<void> {
    const distinctId = this.getDistinctId(userId);
    if (!distinctId) return;

    const event = assertContentFreeProperties({
      name: eventName,
      distinctId,
      properties: options.properties,
    });

    try {
      if (
        options.chapterId &&
        !(await this.isChapterAnalyticsEnabled(options.chapterId))
      ) {
        return;
      }
      await this.provider.capture(event);
    } catch (error) {
      this.logger.warn(
        `Failed to capture analytics event "${eventName}"`,
        error as Error,
      );
    }
  }

  /**
   * Account-deletion propagation: add the user's pseudonym to the provider's
   * "deleted users" list so all their events are purged. Called from the
   * account-deletion flow (#281). No-op when analytics is unconfigured.
   */
  async forgetUser(userId: string): Promise<void> {
    const distinctId = this.getDistinctId(userId);
    if (!distinctId) return;
    try {
      await this.provider.forget(distinctId);
    } catch (error) {
      this.logger.warn('Failed to forget analytics user', error as Error);
    }
  }

  /**
   * Per-chapter opt-out (defense in depth; the client SDK is the first gate).
   * A chapter opts out by setting `chapters.analytics_opt_out = true`
   * (wired by the Settings toggle, #466). Read fresh per event — analytics is a
   * fire-and-forget cold path, not latency-critical, and a single PK-indexed
   * read keeps the toggle effective immediately (no cache to go stale).
   *
   * Fails *closed*: a lookup error suppresses the event. For a privacy control
   * the safe default is to not send when we cannot confirm the chapter is
   * opted in — losing a few events on a DB blip is preferable to emitting for a
   * chapter that may have opted out.
   */
  private async isChapterAnalyticsEnabled(chapterId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('analytics_opt_out')
      .eq('id', chapterId)
      .maybeSingle();

    if (error) {
      this.logger.warn(
        `analytics opt-out lookup failed for chapter ${chapterId}; suppressing event`,
        error,
      );
      return false; // fail closed: do not emit when opt-out state is unknown
    }

    const optedOut =
      ((data as Record<string, unknown> | null)?.['analytics_opt_out'] as
        | boolean
        | null) ?? false;
    return !optedOut;
  }
}
