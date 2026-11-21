import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AskFeedbackRating,
  AskFeedbackReason,
  AskSignal,
} from '@repo/validation';
import type { AskFeedbackRow } from '#domain/entities/ask-trace.entity';
import {
  ASK_TRACE_REPOSITORY,
  type AskTraceSummary,
  type IAskTraceRepository,
} from '#domain/repositories/ask-trace.repository.interface';
import { AnalyticsService } from '../../analytics.service';

/** The PostHog events a thumbs sends: set or changed, and taken back. */
export const ASK_RATED_EVENT = 'ai-answer-rated';
export const ASK_RATING_CLEARED_EVENT = 'ai-answer-rating-cleared';
/** The PostHog event a tap under an answer sends (`ASK_SIGNALS`). */
export const ASK_SIGNAL_EVENT = 'ai-answer-signal';

/** Who is acting on which answer. Both ids come from the guards. */
export interface AskFeedbackActor {
  chapterId: string;
  userId: string;
  askId: string;
}

/**
 * One answer for an ask that is someone else's, another chapter's, swept, or
 * never existed, so the route says nothing about which asks exist.
 */
function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'ai.ask.feedback.not_found',
    message: "This answer can't be rated any more.",
  });
}

/**
 * A member's thumbs on an Ask answer, and the taps under it (#4902,
 * `spec/behavior/ai.md` § Feedback on an answer).
 *
 * - **Only the asker.** A thumbs or a signal names an ask; it is taken only
 *   when that ask's trace says this member asked it in this chapter.
 * - **No text.** A rating, one of four reasons, a signal from a closed set.
 *   A thumbs down never sends the question or the answer: the member may
 *   then choose to, through Report this and its own confirmation.
 * - **One per answer, changeable.** The same route sets and replaces it, and
 *   it can be taken back. It is deleted with its trace.
 * - **A signal is an event only.** Nothing is kept in the database for it.
 */
@Injectable()
export class AskFeedbackService {
  constructor(
    @Inject(ASK_TRACE_REPOSITORY) private readonly traces: IAskTraceRepository,
    private readonly analytics: AnalyticsService,
  ) {}

  async rate(
    actor: AskFeedbackActor,
    rating: AskFeedbackRating,
    reason: AskFeedbackReason | null,
    now: Date = new Date(),
  ): Promise<AskFeedbackRow> {
    if (reason !== null && rating !== 'down') {
      throw new BadRequestException({
        code: 'ai.ask.feedback.reason_needs_down',
        message: 'A reason goes with a thumbs down only.',
      });
    }
    const trace = await this.mine(actor);
    const before = await this.traces.findFeedback(
      trace.id,
      actor.chapterId,
      actor.userId,
    );
    const row = await this.traces.upsertFeedback({
      askId: trace.id,
      chapterId: actor.chapterId,
      userId: actor.userId,
      rating,
      reason,
      now,
    });
    // The trace was swept, or the member said No, between the two calls.
    if (!row) throw notFound();
    // The same thumbs sent again (a retry, a second device) is not a
    // second rating, so it is not counted as one.
    if (before?.rating !== rating || (before.reason ?? null) !== reason) {
      this.track(ASK_RATED_EVENT, actor, trace, { rating, reason });
    }
    return row;
  }

  /** Takes the thumbs back. Fine to call when there is none. */
  async clear(actor: AskFeedbackActor): Promise<void> {
    const trace = await this.mine(actor);
    if (
      await this.traces.deleteFeedback(trace.id, actor.chapterId, actor.userId)
    ) {
      this.track(ASK_RATING_CLEARED_EVENT, actor, trace, {});
    }
  }

  async signal(actor: AskFeedbackActor, signal: AskSignal): Promise<void> {
    const trace = await this.mine(actor);
    this.track(ASK_SIGNAL_EVENT, actor, trace, { signal });
  }

  private async mine(actor: AskFeedbackActor): Promise<AskTraceSummary> {
    const trace = await this.traces.findForAsker(
      actor.askId,
      actor.chapterId,
      actor.userId,
    );
    if (!trace) throw notFound();
    return trace;
  }

  /**
   * Never awaited and never in the member's way. The turn's own codes go
   * along, so a down rate can be read per prompt version and model without
   * a join.
   */
  private track(
    event: string,
    actor: AskFeedbackActor,
    trace: AskTraceSummary,
    properties: Record<string, string | null>,
  ): void {
    this.analytics
      .track(event, actor.userId, {
        chapterId: actor.chapterId,
        app: 'api',
        properties: {
          ask_id: trace.id,
          ...properties,
          door: trace.door,
          prompt_version: trace.prompt_version,
          model: trace.model,
          effort: trace.effort,
          outcome: trace.outcome,
        },
      })
      .catch(() => undefined);
  }
}
