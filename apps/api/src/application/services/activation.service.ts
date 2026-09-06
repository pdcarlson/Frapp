import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  activationMilestoneStep,
  type ActivationMilestone,
  type AnalyticsProperties,
} from '@repo/validation';
import {
  ACTIVATION_MILESTONE_REPOSITORY,
  type IActivationMilestoneRepository,
} from '#domain/repositories/activation-milestone.repository.interface';
import { AnalyticsService } from './analytics.service';

/**
 * The free-to-paid activation funnel (#267).
 *
 * Seven milestones mark a chapter's path from "signed up" to "paying", and
 * product decisions about module gating and the free chat wedge depend on
 * knowing which step chapters stall at. This service is the single place that
 * decides a milestone has been reached for the first time and records it in
 * both places that need it: the `chapter_activation_milestones` table (durable,
 * queryable with plain SQL) and the analytics provider (dashboards).
 *
 * Two properties the call sites depend on:
 *
 *  - **Exactly once per chapter.** The table's unique key decides it, so a
 *    Stripe webhook redelivery, a retried request, or two concurrent members
 *    posting the "first" message cannot double-count.
 *  - **Never fails the caller.** Every one of the seven call sites is a real
 *    product action — a checkout, an invite, a message send. Telemetry that can
 *    break a payment is worse than missing telemetry, so everything here is
 *    swallowed and logged.
 *
 * Canonical behavior: `spec/behavior/observability.md` (#activation-funnel).
 */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    @Inject(ACTIVATION_MILESTONE_REPOSITORY)
    private readonly milestones: IActivationMilestoneRepository,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Record that `chapterId` reached `milestone`, if it never had before.
   *
   * Returns whether this call was the first — call sites generally ignore it,
   * but it makes the "did it fire?" question directly assertable in tests
   * instead of only observable through a mock.
   *
   * `properties` are extra behavioral facts for the provider (e.g. which paid
   * module was enabled). They must be content-free scalars; the analytics
   * boundary enforces that.
   */
  async record(
    chapterId: string,
    milestone: ActivationMilestone,
    properties?: AnalyticsProperties,
  ): Promise<boolean> {
    try {
      const isFirst = await this.milestones.recordFirst(chapterId, milestone);
      if (!isFirst) return false;

      // Only first occurrences are emitted, so the provider sees at most one
      // event per chapter per step and the funnel needs no de-duplication.
      // `step` is spread last so a caller cannot shadow the funnel's own
      // ordering with a property of the same name.
      await this.analytics.trackForChapter(milestone, chapterId, {
        ...properties,
        step: activationMilestoneStep(milestone),
      });

      return true;
    } catch (error) {
      // Includes the content/PII assertion, which is an authoring bug rather
      // than a runtime condition — hence `error` level. It still must not
      // propagate: the caller is mid-checkout or mid-message-send.
      this.logger.error(
        `Failed to record activation milestone "${milestone}" for chapter ${chapterId}`,
        error instanceof Error ? error.stack : error,
      );
      return false;
    }
  }
}
