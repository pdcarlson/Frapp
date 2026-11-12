import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
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
  type AiCallOutcome,
  type IAiUsageRecorder,
} from '#domain/adapters/ai-usage-recorder.interface';
import {
  LANGUAGE_MODEL_REGISTRY,
  LanguageModelError,
  type EmbeddingPurpose,
  type ILanguageModel,
  type ILanguageModelRegistry,
  type LanguageModelCitation,
  type LanguageModelErrorKind,
  type LanguageModelMessage,
  type LanguageModelRequest,
  type LanguageModelResult,
  type LanguageModelSource,
  type LanguageModelUsage,
} from '#domain/adapters/language-model.interface';
import {
  aiCatalogEntry,
  aiCostMicroUsd,
  type AiCatalogEntry,
  type AiTokenCatalogEntry,
  type AiCitedTaskName,
  type AiEmbeddingTaskName,
  type AiStructuredTaskName,
  type AiTaskName,
  type EmbeddingCatalogEntry,
  type GenerationCatalogEntry,
} from '#domain/constants/ai-model-catalog';
import { verifyCitations } from '#domain/utils/quote-grounding';
import { isAiEnabled } from '../../../config/ai-config';
import { estimateTokens } from '#domain/utils/token-estimate';
import {
  AiTelemetryService,
  type AiCallShape,
  type IAiTelemetry,
} from './ai-telemetry.service';

/**
 * Why a call was not made. Nothing reached a provider and nothing was spent.
 *
 * - `disabled`: the server switch is off (`AI_ENABLED`).
 * - `not_configured`: the task's provider has no credential here.
 * - `consent`: the chapter's switch is off, or the acting member has not said
 *   yes. `detail` says which.
 * - `spend_cap`: the call's worst case would cross a cap. `detail` says which.
 */
export interface AiUnavailable {
  status: 'unavailable';
  reason: 'disabled' | 'not_configured' | 'consent' | 'spend_cap';
  detail?:
    | 'chapter_off'
    | 'member_declined'
    | 'chapter_cap'
    | 'member_cap'
    | 'platform_cap';
}

/** The provider declined under its own policy. */
export interface AiRefused {
  status: 'refused';
  category: string | null;
}

export type AiObjectResult<T> =
  | { status: 'ok'; value: T; usage: LanguageModelUsage }
  /** The model answered, and the answer did not match the schema. */
  | { status: 'invalid_output' }
  | AiRefused
  | AiUnavailable;

export type AiCitedResult =
  | {
      status: 'ok';
      text: string;
      /** Only citations whose quote is word for word in its source. */
      citations: LanguageModelCitation[];
      /** How many the check dropped, for the caller to mark unsupported claims. */
      droppedCitations: number;
      truncated: boolean;
      usage: LanguageModelUsage;
    }
  | AiRefused
  | AiUnavailable;

export type AiCitedStreamEvent =
  { type: 'text'; delta: string } | { type: 'end'; result: AiCitedResult };

export type AiEmbeddingResult =
  | { status: 'ok'; vectors: number[][]; model: string; dimensions: number }
  | AiUnavailable;

/** What every generation call brings. */
export interface AiPrompt {
  /** `<feature>@vN`. Stamped on the ledger row and the event. */
  promptVersion: string;
  system?: string;
  messages: LanguageModelMessage[];
  signal?: AbortSignal;
}

/** The kinds of call this gateway makes; a transcription is not one. */
type GatewayCallKind = AiTokenCatalogEntry['kind'];

type EntryOfKind<K extends GatewayCallKind> = K extends 'embedding'
  ? EmbeddingCatalogEntry
  : GenerationCatalogEntry;

interface Admitted<E extends AiTokenCatalogEntry> {
  entry: E;
  model: ILanguageModel;
  call: AiCallDescriptor;
  reservationId: string | null;
}

/** What one provider call came to, before it is recorded. */
interface Finished<R> {
  value: R;
  outcome: AiCallOutcome;
  usage: LanguageModelUsage;
}

interface CallSummary {
  outcome: AiCallOutcome;
  errorKind: LanguageModelErrorKind | null;
  usage: LanguageModelUsage;
  shape: AiCallShape;
}

const NO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

/**
 * The one way a feature reaches a model (ADR-28 decisions 1, 2, 4 and 12).
 *
 * A feature names a catalog task and hands over its prompt; it never names a
 * provider or a model. Every call runs the same steps in the same order:
 *
 * 1. the server switch (`AI_ENABLED`), then the task's adapter;
 * 2. the consent check (seam 1);
 * 3. the spend reservation against the caps (seam 2);
 * 4. the provider call, in its own Sentry span;
 * 5. Frapp's checks on what came back: the schema for a structured task, the
 *    word-for-word quote check for a cited one;
 * 6. the usage record (seam 3), awaited before the result is returned, and a
 *    content-free PostHog event.
 *
 * Steps 1 to 3 stopping a call is an ordinary result (`unavailable`), as is a
 * provider refusal; a feature shows the member something for each. Only a
 * provider failure throws, always as a `LanguageModelError`, which carries
 * no provider text.
 *
 * No prompt, answer or source text is logged, attached to an error, put on a
 * span or sent to analytics here, and the three seams are given none.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    @Inject(LANGUAGE_MODEL_REGISTRY)
    private readonly models: ILanguageModelRegistry,
    @Inject(AI_CONSENT_CHECK) private readonly consent: IAiConsentCheck,
    @Inject(AI_SPEND_RESERVATION) private readonly spend: IAiSpendReservation,
    @Inject(AI_USAGE_RECORDER) private readonly recorder: IAiUsageRecorder,
    @Inject(AiTelemetryService) private readonly telemetry: IAiTelemetry,
  ) {}

  /**
   * One JSON value matching `schema`, through the provider's structured
   * output mode. The value is parsed with `schema` again here, so the caller
   * gets a typed value or `invalid_output`, never a guess.
   *
   * A structured task does not cite. A quote it returns as a proposal's
   * source is checked by the caller with `isQuoteGrounded`
   * (`#domain/utils/quote-grounding`), the same rule a citation gets.
   */
  async generateObject<T>(
    task: AiStructuredTaskName,
    prompt: AiPrompt & { schema: z.ZodType<T> },
    context: AiCallContext,
  ): Promise<AiObjectResult<T>> {
    // Before anything is reserved: a schema JSON Schema cannot express (a
    // date, a transform) throws here, as the caller's bug, with nothing held.
    const schema = z.toJSONSchema(prompt.schema);

    const admitted = await this.admit(task, 'structured', prompt, context, []);
    if ('status' in admitted) return admitted;

    const request: LanguageModelRequest = {
      ...this.baseRequest(admitted, prompt),
      kind: 'structured',
      schema,
    };

    type Result = Finished<AiObjectResult<T>>;
    return this.attempt(admitted, 'structured', async (): Promise<Result> => {
      let result: LanguageModelResult;
      try {
        result = await admitted.model.generate(request);
      } catch (error) {
        if (
          error instanceof LanguageModelError &&
          error.kind === 'invalid_output'
        ) {
          return {
            value: { status: 'invalid_output' },
            outcome: 'invalid_output',
            usage: error.details.usage ?? NO_USAGE,
          };
        }
        throw error;
      }
      if (result.outcome === 'refused') return refusal(result);

      const parsed = prompt.schema.safeParse(result.object);
      if (!parsed.success) {
        return {
          value: { status: 'invalid_output' },
          outcome: 'invalid_output',
          usage: result.usage,
        };
      }
      return {
        value: { status: 'ok', value: parsed.data, usage: result.usage },
        outcome: 'completed',
        usage: result.usage,
      };
    });
  }

  /**
   * Prose, with the quotes it rests on. `sources` is exactly what the model
   * may quote; a citation is kept only when its quote appears word for word
   * in the source it names, and dropped otherwise (decision 4). With no
   * sources, this is a plain prose call.
   */
  async generateCited(
    task: AiCitedTaskName,
    prompt: AiPrompt & { sources: LanguageModelSource[] },
    context: AiCallContext,
  ): Promise<AiCitedResult> {
    const admitted = await this.admit(
      task,
      'cited',
      prompt,
      context,
      prompt.sources,
    );
    if ('status' in admitted) return admitted;

    const request = this.citedRequest(admitted, prompt);
    return this.attempt(admitted, 'cited', async () =>
      citedOutcome(await admitted.model.generate(request), prompt.sources),
    );
  }

  /**
   * {@link generateCited}, with the prose as it is written: `text` events,
   * then one `end` carrying the same result `generateCited` would return,
   * citations checked. A call that is not made yields only the `end`.
   *
   * The text is shown before the citations can be checked, so a client
   * renders citations from `end`, never from the stream.
   */
  async *streamCited(
    task: AiCitedTaskName,
    prompt: AiPrompt & { sources: LanguageModelSource[] },
    context: AiCallContext,
  ): AsyncGenerator<AiCitedStreamEvent, void, void> {
    const admitted = await this.admit(
      task,
      'cited',
      prompt,
      context,
      prompt.sources,
    );
    if ('status' in admitted) {
      yield { type: 'end', result: admitted };
      return;
    }

    const request = this.citedRequest(admitted, prompt);
    const startedAt = Date.now();
    let final: LanguageModelResult | null = null;
    let settled = false;
    try {
      for await (const event of admitted.model.stream(request)) {
        if (event.type === 'text') yield { type: 'text', delta: event.delta };
        else final = event.result;
      }
      if (final === null) {
        // An adapter's stream always ends with its result; one that does not
        // is a bug in the adapter, reported like any other provider failure.
        throw new LanguageModelError('unknown', admitted.entry.provider);
      }
    } catch (error) {
      settled = true;
      await this.settle(admitted, startedAt, failure(error, 'cited', true));
      throw sanitized(error, admitted.entry);
    } finally {
      // The consumer stopped reading (a closed connection) before the end.
      // The provider was still called, so the reservation is still settled.
      // What the provider charged for the part it wrote is not known here:
      // the counts arrive with the end of the stream, which never came.
      if (final === null && !settled) {
        await this.settle(admitted, startedAt, {
          outcome: 'error',
          errorKind: 'aborted',
          usage: NO_USAGE,
          shape: {
            kind: 'cited',
            streamed: true,
            citationsKept: 0,
            citationsDropped: 0,
          },
        }).catch((error: unknown) => {
          // Nobody is left to throw to. Say so, without the error's message:
          // a reservation that was not settled is the ledger's to release.
          this.logger.warn(
            `AI usage record failed for an abandoned stream (task ${admitted.call.task}, ${
              error instanceof Error ? error.name : 'unknown error'
            })`,
          );
        });
      }
    }

    const { value, ...summary } = citedOutcome(final, prompt.sources);
    await this.settle(admitted, startedAt, {
      ...summary,
      errorKind: null,
      shape: shapeOf('cited', value, true),
    });
    yield { type: 'end', result: value };
  }

  /** One vector per text, at the catalog's dimensions for the task. */
  async embed(
    task: AiEmbeddingTaskName,
    input: {
      texts: string[];
      promptVersion: string;
      /** What the texts are, for a model that embeds the two differently. */
      purpose?: EmbeddingPurpose;
      signal?: AbortSignal;
    },
    context: AiCallContext,
  ): Promise<AiEmbeddingResult> {
    const admitted = await this.admit(
      task,
      'embedding',
      { promptVersion: input.promptVersion, messages: [] },
      context,
      input.texts.map((text) => ({ text })),
    );
    if ('status' in admitted) return admitted;
    const { entry, model } = admitted;

    return this.attempt(admitted, 'embedding', async () => {
      const result = await model.embed({
        task,
        model: entry.model,
        texts: input.texts,
        dimensions: entry.dimensions,
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        signal: input.signal,
      });
      return {
        value: {
          status: 'ok',
          vectors: result.vectors,
          model: entry.model,
          dimensions: entry.dimensions,
        },
        outcome: 'completed',
        usage: { ...NO_USAGE, inputTokens: result.inputTokens },
      };
    });
  }

  /**
   * Steps 1 to 3: decide whether the call is made. Returns what the call
   * needs, or the `unavailable` result to hand straight back.
   */
  private async admit<K extends GatewayCallKind>(
    task: AiTaskName,
    kind: K,
    prompt: Pick<AiPrompt, 'promptVersion' | 'system' | 'messages'>,
    context: AiCallContext,
    extraInput: ReadonlyArray<{ text: string }>,
  ): Promise<Admitted<EntryOfKind<K>> | AiUnavailable> {
    if (!isAiEnabled()) return { status: 'unavailable', reason: 'disabled' };

    const found = aiCatalogEntry(task);
    if (found.kind !== kind) {
      // The task-name types already prevent this; a cast got past them.
      throw new Error(`AI task ${task} is ${found.kind}, not ${kind}`);
    }
    // A transcription task never gets here: its kind is none of this
    // gateway's three, and `AiTranscriptionService` serves it.
    const entry = found;

    const model = this.models.resolve(entry.provider);
    if (!model) return { status: 'unavailable', reason: 'not_configured' };

    const call: AiCallDescriptor = {
      chapterId: context.chapterId,
      actingUserId: context.actingUserId,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      task,
      family: entry.family,
      // The adapter that will answer, which in scripted mode is not the
      // catalog's provider: a canned reply is never recorded as Anthropic's.
      provider: model.provider,
      model: entry.model,
      promptVersion: prompt.promptVersion,
    };

    const consent = await this.consent.check(call);
    if (!consent.allowed) {
      return {
        status: 'unavailable',
        reason: 'consent',
        detail: consent.reason,
      };
    }

    const inputTokens = estimateTokens(
      [
        prompt.system ?? '',
        ...prompt.messages.map((message) => message.content),
        ...extraInput.map((input) => input.text),
      ].join('\n'),
    );
    const maxOutputTokens =
      entry.kind === 'embedding' ? 0 : entry.maxOutputTokens;
    const reservation = await this.spend.reserve(call, {
      inputTokens,
      maxOutputTokens,
      maxCostMicroUsd: aiCostMicroUsd(entry, {
        inputTokens,
        outputTokens: maxOutputTokens,
      }),
    });
    if (!reservation.granted) {
      return {
        status: 'unavailable',
        reason: 'spend_cap',
        detail: reservation.reason,
      };
    }

    return {
      entry: entry as EntryOfKind<K>,
      model,
      call,
      reservationId: reservation.reservationId,
    };
  }

  /**
   * Steps 4 to 6 for a call that returns once: run it in the span, then
   * record what it cost whether it returned or threw.
   */
  private attempt<R>(
    admitted: Admitted<AiTokenCatalogEntry>,
    kind: GatewayCallKind,
    run: () => Promise<Finished<R>>,
  ): Promise<R> {
    return this.telemetry.inSpan(admitted.call, async () => {
      const startedAt = Date.now();
      let finished: Finished<R>;
      try {
        finished = await run();
      } catch (error) {
        await this.settle(admitted, startedAt, failure(error, kind));
        throw sanitized(error, admitted.entry);
      }
      await this.settle(admitted, startedAt, {
        outcome: finished.outcome,
        errorKind: null,
        usage: finished.usage,
        shape: shapeOf(kind, finished.value),
      });
      return finished.value;
    });
  }

  /** Step 6: the ledger row, then the event. */
  private async settle(
    admitted: Admitted<AiTokenCatalogEntry>,
    startedAt: number,
    summary: CallSummary,
  ): Promise<void> {
    const record = {
      ...admitted.call,
      reservationId: admitted.reservationId,
      outcome: summary.outcome,
      errorKind: summary.errorKind,
      inputTokens: summary.usage.inputTokens,
      outputTokens: summary.usage.outputTokens,
      cachedInputTokens: summary.usage.cachedInputTokens,
      costMicroUsd: aiCostMicroUsd(admitted.entry, summary.usage),
      latencyMs: Date.now() - startedAt,
    };
    await this.recorder.record(record);
    await this.telemetry.callFinished(record, summary.shape);
  }

  private baseRequest(
    admitted: Admitted<GenerationCatalogEntry>,
    prompt: AiPrompt,
  ) {
    return {
      task: admitted.call.task,
      model: admitted.entry.model,
      ...(prompt.system === undefined ? {} : { system: prompt.system }),
      messages: prompt.messages,
      maxOutputTokens: admitted.entry.maxOutputTokens,
      effort: admitted.entry.effort,
      ...(prompt.signal === undefined ? {} : { signal: prompt.signal }),
    };
  }

  private citedRequest(
    admitted: Admitted<GenerationCatalogEntry>,
    prompt: AiPrompt & { sources: LanguageModelSource[] },
  ): LanguageModelRequest {
    return {
      ...this.baseRequest(admitted, prompt),
      kind: 'cited',
      sources: prompt.sources,
    };
  }
}

function refusal(
  result: Extract<LanguageModelResult, { outcome: 'refused' }>,
): Finished<AiRefused> {
  return {
    value: { status: 'refused', category: result.category },
    outcome: 'refused',
    usage: result.usage,
  };
}

/** Step 5 for a cited call: keep only the quotes that are in their source. */
function citedOutcome(
  result: LanguageModelResult,
  sources: readonly LanguageModelSource[],
): Finished<AiCitedResult> {
  if (result.outcome === 'refused') return refusal(result);
  const { kept, dropped } = verifyCitations(result.citations, sources);
  return {
    value: {
      status: 'ok',
      text: result.text,
      citations: kept,
      droppedCitations: dropped,
      truncated: result.truncated,
      usage: result.usage,
    },
    outcome: 'completed',
    usage: result.usage,
  };
}

function shapeOf(
  kind: GatewayCallKind,
  value: unknown,
  streamed = false,
): AiCallShape {
  const cited = value as Partial<Extract<AiCitedResult, { status: 'ok' }>>;
  return {
    kind,
    streamed,
    citationsKept: kind === 'cited' ? (cited.citations?.length ?? 0) : 0,
    citationsDropped: kind === 'cited' ? (cited.droppedCitations ?? 0) : 0,
  };
}

function failure(
  error: unknown,
  kind: GatewayCallKind,
  streamed = false,
): CallSummary {
  return {
    outcome: 'error',
    errorKind: error instanceof LanguageModelError ? error.kind : 'unknown',
    usage:
      (error instanceof LanguageModelError ? error.details.usage : undefined) ??
      NO_USAGE,
    shape: { kind, streamed, citationsKept: 0, citationsDropped: 0 },
  };
}

/**
 * What the gateway rethrows. An adapter only throws `LanguageModelError`; if
 * something else gets out of one (a bug), it is replaced rather than passed
 * on, because an arbitrary error's message can hold the request.
 */
function sanitized(error: unknown, entry: AiCatalogEntry): LanguageModelError {
  return error instanceof LanguageModelError
    ? error
    : new LanguageModelError('unknown', entry.provider);
}
