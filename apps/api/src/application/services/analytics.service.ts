import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
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
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '../../domain/repositories/member.repository.interface';
import type { Member } from '../../domain/entities/member.entity';

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
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
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
   * HTTP-boundary entry for client-originated events (`POST /v1/analytics/events`).
   * `track` is the lower-level primitive for trusted, server-originated callers
   * (which must not be gated by membership); this method adds the authorization an
   * untrusted client needs before delegating to it. The payload is validated first,
   * so a content/PII event is a 400 regardless of the membership/opt-out outcome
   * (consistent with the DTO `ValidationPipe`, which 400s before this runs).
   *
   *  - **With a `chapterId`:** the caller must be a member of that chapter, else
   *    403. Stops a member of chapter A from attributing events to chapter B.
   *    The per-chapter opt-out is then applied by `track` as usual.
   *  - **Without a `chapterId`:** the opt-out can't be keyed directly, so resolve
   *    the caller's memberships and suppress when they belong to chapters and
   *    *every* one has opted out — closing the "omit `chapter_id` to bypass the
   *    opt-out" hole. A caller with no memberships still emits (no chapter to opt
   *    out of). This path never 403s: a chapter-less event is legitimate (e.g. the
   *    web client before an active chapter is selected).
   *
   * Not a `ChapterGuard`: that guard keys off the `x-chapter-id` header and also
   * enforces a subscription gate — neither fits this body-carried,
   * subscription-exempt endpoint.
   *
   * Spec: `spec/behavior/data-retention.md` (#analytics-events-pseudonymous) — the
   * client SDK is the first gate; this server check is defense in depth.
   */
  async trackFromClient(
    eventName: string,
    userId: string,
    options: TrackOptions = {},
  ): Promise<void> {
    // Analytics off (no salt): nothing will be captured, so skip the membership
    // work and DB hit entirely — mirrors `track`'s own guard.
    const distinctId = this.getDistinctId(userId);
    if (!distinctId) return;

    // Validate the payload up front so a content/PII event is always rejected
    // with a 400 — the payload being malformed is a caller error independent of
    // whether membership/opt-out later suppresses delivery. (`track` re-validates
    // for its own server-originated callers; the assertion is pure and cheap.)
    assertContentFreeProperties({
      name: eventName,
      distinctId,
      properties: options.properties,
    });

    if (options.chapterId) {
      // A clean "not a member" is an authorization denial → 403. A DB error
      // means we *can't* verify membership, so fail closed and suppress — the
      // same posture as the opt-out lookup and the omit path below — rather than
      // 500-ing a fire-and-forget telemetry call. Either way an unverifiable
      // caller never emits.
      let member: Member | null;
      try {
        member = await this.members.findByUserAndChapter(
          userId,
          options.chapterId,
        );
      } catch (error) {
        this.logger.warn(
          'analytics membership check failed; suppressing event',
          error as Error,
        );
        return;
      }
      if (!member) {
        throw new ForbiddenException('Not a member of this chapter');
      }
      await this.track(eventName, userId, options);
      return;
    }

    // No chapter context: enforce the opt-out across the caller's memberships so
    // it can't be sidestepped by omitting `chapter_id`. Users are typically in a
    // single chapter (see spec/behavior/multi-tenancy.md), so this fan-out is
    // normally one read; batching into a single query is a latent optimization.
    try {
      const memberships = await this.members.findByUser(userId);
      if (memberships.length > 0) {
        const enabled = await Promise.all(
          memberships.map((m) => this.isChapterAnalyticsEnabled(m.chapter_id)),
        );
        if (enabled.every((isEnabled) => !isEnabled)) {
          return; // every chapter the caller belongs to has opted out
        }
      }
    } catch (error) {
      // Membership resolution is best-effort like the rest of the cold path: a
      // DB blip suppresses (fail closed) rather than 500-ing a fire-and-forget
      // telemetry call.
      this.logger.warn(
        'analytics membership resolution failed; suppressing event',
        error as Error,
      );
      return;
    }

    await this.track(eventName, userId, options);
  }

  /**
   * Account-deletion propagation: add the user's pseudonym to the provider's
   * "deleted users" list so all their events are purged. Called from the
   * account-deletion flow (#281), which gates the irreversible Supabase Auth
   * deletion on the returned boolean — once the auth account is gone the user
   * can never re-trigger this, so a silently lost forget would retain their
   * events forever. Returns true when the provider acknowledged the forget or
   * there is nothing to forget (analytics unconfigured: no events were ever
   * keyed for this environment).
   */
  async forgetUser(userId: string): Promise<boolean> {
    const distinctId = this.getDistinctId(userId);
    if (!distinctId) return true;
    try {
      return await this.provider.forget(distinctId);
    } catch (error) {
      this.logger.warn('Failed to forget analytics user', error as Error);
      return false;
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
