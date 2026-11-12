import { Inject, Injectable } from '@nestjs/common';
import type {
  AiCallContext,
  AiCallDescriptor,
} from '#domain/adapters/ai-call-context';
import {
  AI_CONSENT_CHECK,
  type IAiConsentCheck,
} from '#domain/adapters/ai-consent-check.interface';
import {
  AI_SPEND_RESERVATION,
  type IAiSpendReservation,
} from '#domain/adapters/ai-spend-reservation.interface';
import {
  AI_USAGE_RECORDER,
  type AiUsageRecord,
  type IAiUsageRecorder,
} from '#domain/adapters/ai-usage-recorder.interface';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import {
  TRANSCRIBER_REGISTRY,
  type ITranscriber,
  type ITranscriberRegistry,
  type TranscriberLimits,
  type TranscriptionAudio,
  type TranscriptionResult,
  type TranscriptionUtterance,
} from '#domain/adapters/transcription.interface';
import {
  aiCatalogEntry,
  aiTranscriptionCostMicroUsd,
  type AiTranscriptionTaskName,
  type TranscriptionCatalogEntry,
} from '#domain/constants/ai-model-catalog';
import { isAiEnabled } from '../../../config/ai-config';
import { AiTelemetryService, type IAiTelemetry } from './ai-telemetry.service';
import type { AiUnavailable } from './ai-gateway.service';

/** The recording is more than the task's vendor takes in one request. */
export interface AiTranscriptionUnsupported {
  status: 'unsupported';
  reason: 'too_long' | 'too_large';
  limits: TranscriberLimits;
}

export type AiTranscriptionResult =
  | {
      status: 'ok';
      /** In the order spoken; empty when no speech was heard. */
      utterances: TranscriptionUtterance[];
      /** As the vendor measured it. */
      durationSeconds: number;
    }
  | AiTranscriptionUnsupported
  | AiUnavailable;

/** Whether a recording could be transcribed here at all, before one exists. */
export type AiTranscriptionAvailability =
  | { available: true; limits: TranscriberLimits }
  | { available: false; reason: 'disabled' | 'not_configured' };

export interface AiTranscriptionInput {
  audio: TranscriptionAudio;
  /** Names to spell right: the roster's. */
  vocabulary: readonly string[];
  /** `<feature>@vN`, stamped on the ledger row like a prompt's version. */
  promptVersion: string;
  resumeJobId: string | null;
  onJobStarted(jobId: string): Promise<void>;
  signal?: AbortSignal;
}

/**
 * The shortest recording a hold is sized for. A stated length is the
 * uploader's word, so a hold is never made for less than this.
 */
const MIN_HELD_SECONDS = 60;

/**
 * The one way a feature has a recording transcribed (ADR-28 decision 1): the
 * gateway's steps, for the one kind of call `AiGatewayService` does not make.
 *
 * 1. the server switch (`AI_ENABLED`), then the task's transcriber, then the
 *    vendor's limits against the recording;
 * 2. the consent check (seam 1);
 * 3. the spend hold (seam 2), for the recording's stated length at the
 *    catalog's price per hour;
 * 4. the vendor call, in its own Sentry span;
 * 5. the usage record (seam 3), awaited before the result is returned, with
 *    the seconds the vendor measured, and a content-free PostHog event.
 *
 * Steps 1 to 3 stopping a call is an ordinary result. Only a vendor failure
 * throws, always as a `LanguageModelError`, which carries no vendor text.
 *
 * Neither the audio, its link nor the transcript is logged, attached to an
 * error, put on a span or sent to analytics here, and the seams are given
 * none of them.
 *
 * **A try that dies while the vendor works is counted twice against the
 * caps.** Its hold is charged as an estimate (the vendor may bill it), and
 * the next try, which resumes the same vendor job, holds and settles again.
 * Over-counting one recording, once, is the safe side of that: the
 * alternative is a resumed call the ledger never sees.
 */
@Injectable()
export class AiTranscriptionService {
  constructor(
    @Inject(TRANSCRIBER_REGISTRY)
    private readonly transcribers: ITranscriberRegistry,
    @Inject(AI_CONSENT_CHECK) private readonly consent: IAiConsentCheck,
    @Inject(AI_SPEND_RESERVATION) private readonly spend: IAiSpendReservation,
    @Inject(AI_USAGE_RECORDER) private readonly recorder: IAiUsageRecorder,
    @Inject(AiTelemetryService) private readonly telemetry: IAiTelemetry,
  ) {}

  /**
   * Whether the task can run on this server, and what its vendor takes. For
   * a feature to hide its entry point, and to refuse a file before it is
   * uploaded, without spending anything.
   */
  availability(task: AiTranscriptionTaskName): AiTranscriptionAvailability {
    if (!isAiEnabled()) return { available: false, reason: 'disabled' };
    const transcriber = this.transcribers.resolve(entryOf(task).provider);
    if (!transcriber) return { available: false, reason: 'not_configured' };
    return { available: true, limits: transcriber.limits };
  }

  async transcribe(
    task: AiTranscriptionTaskName,
    input: AiTranscriptionInput,
    context: AiCallContext,
  ): Promise<AiTranscriptionResult> {
    if (!isAiEnabled()) return { status: 'unavailable', reason: 'disabled' };

    const entry = entryOf(task);
    const transcriber = this.transcribers.resolve(entry.provider);
    if (!transcriber) {
      return { status: 'unavailable', reason: 'not_configured' };
    }

    const { limits } = transcriber;
    if (input.audio.durationSeconds > limits.maxDurationSeconds) {
      return { status: 'unsupported', reason: 'too_long', limits };
    }
    if (input.audio.sizeBytes > limits.maxBytes) {
      return { status: 'unsupported', reason: 'too_large', limits };
    }

    const call: AiCallDescriptor = {
      chapterId: context.chapterId,
      actingUserId: context.actingUserId,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      task,
      family: entry.family,
      // The transcriber that will answer, which in scripted mode is not the
      // catalog's vendor.
      provider: transcriber.provider,
      model: entry.model,
      promptVersion: input.promptVersion,
    };

    const consent = await this.consent.check(call);
    if (!consent.allowed) {
      return {
        status: 'unavailable',
        reason: 'consent',
        detail: consent.reason,
      };
    }

    const reservation = await this.spend.reserve(call, {
      inputTokens: 0,
      maxOutputTokens: 0,
      maxCostMicroUsd: aiTranscriptionCostMicroUsd(
        entry,
        Math.max(MIN_HELD_SECONDS, input.audio.durationSeconds),
      ),
    });
    if (!reservation.granted) {
      return {
        status: 'unavailable',
        reason: 'spend_cap',
        detail: reservation.reason,
      };
    }

    return this.telemetry.inSpan(call, async () => {
      const startedAt = Date.now();
      const settle = async (
        outcome: Pick<AiUsageRecord, 'outcome' | 'errorKind'>,
        audioSeconds: number,
      ): Promise<void> => {
        const record: AiUsageRecord = {
          ...call,
          reservationId: reservation.reservationId,
          ...outcome,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          audioSeconds,
          costMicroUsd: aiTranscriptionCostMicroUsd(entry, audioSeconds),
          latencyMs: Date.now() - startedAt,
        };
        await this.recorder.record(record);
        await this.telemetry.callFinished(record, {
          kind: 'transcription',
          streamed: false,
          citationsKept: 0,
          citationsDropped: 0,
        });
      };

      let result: TranscriptionResult;
      try {
        result = await this.run(transcriber, entry, task, input);
      } catch (error) {
        // An adapter only throws `LanguageModelError`; anything else is a
        // bug, and is replaced, because an arbitrary error's message could
        // hold the recording's link.
        const failure =
          error instanceof LanguageModelError
            ? error
            : new LanguageModelError('unknown', transcriber.provider);
        await settle({ outcome: 'error', errorKind: failure.kind }, 0);
        throw failure;
      }
      // Outside the `try`, as the gateway settles: a ledger write that fails
      // is not a provider error, and must not be settled a second time as one.
      await settle(
        { outcome: 'completed', errorKind: null },
        Math.max(0, Math.ceil(result.durationSeconds)),
      );
      return { status: 'ok', ...result } as const;
    });
  }

  /**
   * Has the provider delete what it keeps of a job. No consent or spend
   * check: it sends nothing and costs nothing. Never throws.
   */
  async discard(task: AiTranscriptionTaskName, jobId: string): Promise<void> {
    // With the server switch off too: turning AI off must not strand a
    // recording at the provider.
    const transcriber = this.transcribers.resolve(entryOf(task).provider);
    if (!transcriber) return;
    try {
      await transcriber.discard(jobId);
    } catch {
      // The port says it never throws; this is the belt. The job id names a
      // member's recording at the provider, so nothing is logged.
    }
  }

  private run(
    transcriber: ITranscriber,
    entry: TranscriptionCatalogEntry,
    task: string,
    input: AiTranscriptionInput,
  ) {
    return transcriber.transcribe({
      task,
      model: entry.model,
      audio: input.audio,
      vocabulary: input.vocabulary,
      resumeJobId: input.resumeJobId,
      onJobStarted: (jobId) => input.onJobStarted(jobId),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }
}

function entryOf(task: AiTranscriptionTaskName): TranscriptionCatalogEntry {
  const entry = aiCatalogEntry(task);
  if (entry.kind !== 'transcription') {
    // The task-name type already prevents this; a cast got past it.
    throw new Error(`AI task ${task} is ${entry.kind}, not transcription`);
  }
  return entry;
}
