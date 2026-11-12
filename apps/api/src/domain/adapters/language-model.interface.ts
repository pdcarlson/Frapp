/**
 * The provider-neutral port every model call goes through (ADR-28 decision 1).
 *
 * Adapters under `infrastructure/ai/` implement it: one per provider, and a
 * scripted one that needs no network. Nothing else imports a provider SDK
 * (dependency-cruiser rule `ai-provider-sdks-only-in-adapters`), and no
 * feature calls an adapter directly: the caller is `AiGatewayService`, which
 * owns the consent check, the spend reservation, the citation check and the
 * usage record around each call.
 *
 * The shapes here are Frapp's own, never a provider's. A request names its
 * task and the model the catalog picked for it, and says which of two
 * things it wants back:
 *
 * - `structured`: one JSON value matching a schema, through the provider's
 *   structured output mode. Never a forced tool call: current Claude models
 *   refuse a forced `tool_choice`.
 * - `cited`: prose plus the quotes it rests on, each naming the source it was
 *   taken from. The adapter says what the model quoted; whether a quote is
 *   really in its source is the gateway's check, not the provider's
 *   (decision 4). A request with no sources is plain prose.
 *
 * The two never combine: a provider's structured output mode and its
 * citations are mutually exclusive, so a feature that needs both makes two
 * calls (`spec/architecture/README.md` §13, Citation protocol).
 */
export const LANGUAGE_MODEL_REGISTRY = 'LANGUAGE_MODEL_REGISTRY';

export type AiProvider = 'anthropic' | 'google' | 'scripted';

export type LanguageModelEffort = 'low' | 'medium' | 'high';

export interface LanguageModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One source a `cited` request may quote. `id` is Frapp's id for it. */
export interface LanguageModelSource {
  id: string;
  title: string;
  text: string;
}

/** A quote the model says it took from the source with this id. */
export interface LanguageModelCitation {
  sourceId: string;
  quote: string;
  /**
   * Where in the result's `text` the model attached the quote: the offset
   * just past the span it backs, when the provider says (Claude's citations
   * arrive on a span of prose). Absent when it does not; the feature then
   * places the marker itself (`#domain/utils/citation-placement`).
   */
  at?: number;
}

export interface LanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens the provider served from its cache, already in `inputTokens`. */
  cachedInputTokens: number;
}

interface LanguageModelRequestBase {
  /** The catalog task this call is for, e.g. `minutes.draft`. */
  task: string;
  /** The provider's model id, from the catalog. */
  model: string;
  system?: string;
  messages: LanguageModelMessage[];
  maxOutputTokens: number;
  effort?: LanguageModelEffort;
  signal?: AbortSignal;
}

export interface StructuredLanguageModelRequest extends LanguageModelRequestBase {
  kind: 'structured';
  /** JSON Schema for the one value the model must return. */
  schema: Record<string, unknown>;
}

export interface CitedLanguageModelRequest extends LanguageModelRequestBase {
  kind: 'cited';
  sources: LanguageModelSource[];
}

export type LanguageModelRequest =
  StructuredLanguageModelRequest | CitedLanguageModelRequest;

export interface LanguageModelCompletion {
  outcome: 'completed';
  text: string;
  /** The parsed JSON value of a `structured` request; absent otherwise. */
  object?: unknown;
  /** What a `cited` request quoted, unchecked; empty otherwise. */
  citations: LanguageModelCitation[];
  /** The output hit `maxOutputTokens` and stops mid-thought. */
  truncated: boolean;
  usage: LanguageModelUsage;
}

/**
 * The provider declined the request under its own policy. A typed result,
 * not an error: the caller shows the member something, and the ledger still
 * records what the call cost.
 */
export interface LanguageModelRefusal {
  outcome: 'refused';
  /** The provider's low-cardinality category, when it gives one. */
  category: string | null;
  usage: LanguageModelUsage;
}

export type LanguageModelResult =
  LanguageModelCompletion | LanguageModelRefusal;

export type LanguageModelStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; result: LanguageModelResult };

/**
 * What is being embedded. Retrieval models embed a passage and a question
 * about it differently (Gemini's `RETRIEVAL_DOCUMENT` and `RETRIEVAL_QUERY`
 * task types), so the corpus says which (#720). An adapter whose model makes
 * no difference ignores it.
 */
export type EmbeddingPurpose = 'document' | 'query';

export interface EmbeddingRequest {
  task: string;
  model: string;
  texts: string[];
  dimensions: number;
  purpose?: EmbeddingPurpose;
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  /** One vector per input text, in order, each `dimensions` long. */
  vectors: number[][];
  inputTokens: number;
}

export type LanguageModelErrorKind =
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'connection'
  | 'auth'
  | 'invalid_request'
  | 'invalid_output'
  | 'unsupported'
  | 'aborted'
  | 'unknown';

const RETRYABLE_KINDS: ReadonlySet<LanguageModelErrorKind> = new Set([
  'rate_limited',
  'overloaded',
  'timeout',
  'connection',
]);

/**
 * The only error an adapter throws.
 *
 * It carries no text from the provider. A provider's error message can quote
 * the request back ("messages.0.content: ..."), and an error is logged and
 * sent to Sentry with its message and its `cause`, so the adapter keeps the
 * kind, the HTTP status, the provider's request id and token counts, and
 * drops the rest.
 * `message` is built from those alone.
 */
export class LanguageModelError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly kind: LanguageModelErrorKind,
    readonly provider: AiProvider,
    readonly details: {
      status?: number;
      requestId?: string;
      /**
       * What the provider charged before the call failed, when it said: a
       * reply that could not be read as JSON was still generated and billed.
       */
      usage?: LanguageModelUsage;
    } = {},
  ) {
    super(
      `AI provider call failed: ${kind}` +
        (details.status === undefined ? '' : ` (status ${details.status})`),
    );
    this.name = 'LanguageModelError';
    this.retryable = RETRYABLE_KINDS.has(kind);
  }
}

export interface ILanguageModel {
  readonly provider: AiProvider;

  /** One call, one result. Throws only {@link LanguageModelError}. */
  generate(request: LanguageModelRequest): Promise<LanguageModelResult>;

  /**
   * The same call, with the prose as it is written. Yields `text` events and
   * then exactly one `done` carrying the whole result. Throws only
   * {@link LanguageModelError}.
   */
  stream(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelStreamEvent>;

  /** Throws `unsupported` when the provider has no embedding model. */
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

/**
 * The adapters this process can use, by provider. `null` means the provider
 * has no credential here, so a task the catalog routes to it is not available.
 */
export interface ILanguageModelRegistry {
  resolve(provider: AiProvider): ILanguageModel | null;
}
