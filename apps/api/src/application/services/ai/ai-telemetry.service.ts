import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import type { AiUsageRecord } from '#domain/adapters/ai-usage-recorder.interface';
import { AnalyticsService } from '../analytics.service';

/** What the gateway knows about a finished call beyond its usage record. */
export interface AiCallShape {
  kind: 'structured' | 'cited' | 'embedding';
  /**
   * A streamed call has no span of its own (a span cannot stay open across
   * the reader's pauses), so its counts are not put on whatever span is
   * active, which would be the request's.
   */
  streamed: boolean;
  /** Citations that passed the word-for-word check; 0 for other kinds. */
  citationsKept: number;
  /** Citations the check dropped; 0 for other kinds. */
  citationsDropped: number;
}

/** The gateway's view of this service, so a test or an eval can stand in. */
export interface IAiTelemetry {
  inSpan<T>(call: AiCallDescriptor, run: () => Promise<T>): Promise<T>;
  callFinished(record: AiUsageRecord, shape: AiCallShape): Promise<void>;
}

/** The PostHog event one provider call sends. */
export const AI_CALL_EVENT = 'ai-call-finished';

/**
 * What an AI call leaves in Sentry and PostHog: counts, timings, the model
 * and the cost, and no text (ADR-28 decision 12).
 *
 * Both are built by hand from the usage record, which has no text field, so
 * there is nothing here that could attach a prompt or an answer. No vendor
 * wrapper around the provider client is involved: Sentry's own AI
 * integrations are left out of the SDK altogether (`sentry-options.ts`,
 * #3280).
 */
@Injectable()
export class AiTelemetryService implements IAiTelemetry {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Run the provider call inside its own span. The attributes are the
   * `ai.*` keys on the transaction scrubber's allowlist; anything else set on
   * a span is dropped before it leaves the process.
   */
  inSpan<T>(call: AiCallDescriptor, run: () => Promise<T>): Promise<T> {
    return Sentry.startSpan(
      {
        name: 'ai.gateway.call',
        op: 'ai.gateway',
        attributes: {
          'ai.task': call.task,
          'ai.provider': call.provider,
          'ai.model': call.model,
        },
      },
      run,
    );
  }

  async callFinished(record: AiUsageRecord, shape: AiCallShape): Promise<void> {
    if (!shape.streamed) {
      Sentry.getActiveSpan()?.setAttributes({
        'ai.outcome': record.outcome,
        'ai.input_tokens': record.inputTokens,
        'ai.output_tokens': record.outputTokens,
      });
    }

    // Every string below is from a closed set: the catalog, the prompt's
    // version, or an outcome enum. `track` checks the keys again.
    await this.analytics.track(AI_CALL_EVENT, record.actingUserId, {
      chapterId: record.chapterId,
      app: 'api',
      properties: {
        task: record.task,
        family: record.family,
        kind: shape.kind,
        provider: record.provider,
        model: record.model,
        prompt_version: record.promptVersion,
        outcome: record.outcome,
        error_kind: record.errorKind,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        cached_input_tokens: record.cachedInputTokens,
        cost_micro_usd: record.costMicroUsd,
        latency_ms: record.latencyMs,
        citations_kept: shape.citationsKept,
        citations_dropped: shape.citationsDropped,
        is_background_run: record.runId !== undefined,
      },
    });
  }
}
