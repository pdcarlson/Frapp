import Anthropic from '@anthropic-ai/sdk';
import {
  LanguageModelError,
  type EmbeddingResult,
  type ILanguageModel,
  type LanguageModelCitation,
  type LanguageModelErrorKind,
  type LanguageModelRequest,
  type LanguageModelResult,
  type LanguageModelStreamEvent,
  type LanguageModelUsage,
} from '#domain/adapters/language-model.interface';

/** The slice of the SDK client this adapter calls, so a test can stand in for it. */
export type AnthropicMessagesClient = Pick<Anthropic, 'messages'>;

/**
 * Claude on Anthropic's own API. One of two files that may import
 * `@anthropic-ai/sdk` (the other is its spec); dependency-cruiser enforces it.
 *
 * What it does not do, on purpose:
 * - No provider-side state: no Files API, no stored documents, no message
 *   threads (ADR-28 decision 10). Every request carries what it needs.
 * - No server-side model fallback. The catalog names one model per task and
 *   the evals grade that model, so a refusal comes back as a refusal.
 * - No `thinking` or sampling parameters. Current Claude models think
 *   adaptively by default and reject a fixed budget or a temperature; depth
 *   is set by `effort`, from the catalog.
 * - No forced `tool_choice` for JSON. A strict shape uses structured outputs.
 */
export class AnthropicLanguageModel implements ILanguageModel {
  readonly provider = 'anthropic' as const;

  constructor(private readonly client: AnthropicMessagesClient) {}

  static fromApiKey(apiKey: string): AnthropicLanguageModel {
    return new AnthropicLanguageModel(new Anthropic({ apiKey }));
  }

  async generate(request: LanguageModelRequest): Promise<LanguageModelResult> {
    try {
      const message = await this.client.messages.create(this.params(request), {
        signal: request.signal,
      });
      return this.toResult(request, message);
    } catch (error) {
      throw toLanguageModelError(error);
    }
  }

  async *stream(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelStreamEvent> {
    try {
      const stream = this.client.messages.stream(this.params(request), {
        signal: request.signal,
      });
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', delta: event.delta.text };
        }
      }
      yield {
        type: 'done',
        result: this.toResult(request, await stream.finalMessage()),
      };
    } catch (error) {
      throw toLanguageModelError(error);
    }
  }

  embed(): Promise<EmbeddingResult> {
    // Anthropic has no embedding model. The catalog routes embeddings to
    // Google (ADR-28 decision 3).
    return Promise.reject(new LanguageModelError('unsupported', 'anthropic'));
  }

  private params(
    request: LanguageModelRequest,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const messages: Anthropic.MessageParam[] = request.messages.map(
      (message) => ({ role: message.role, content: message.content }),
    );

    if (request.kind === 'cited') {
      // Sources go in as documents with citations on, ahead of the
      // conversation, so the model quotes them through the provider's own
      // citation mechanism. `document_index` in a returned citation is the
      // position in this array, which is how a quote is mapped back to
      // Frapp's source id. The quotes are still checked by the gateway.
      messages.unshift({
        role: 'user',
        content: request.sources.map(
          (source): Anthropic.DocumentBlockParam => ({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: source.text,
            },
            title: source.title,
            citations: { enabled: true },
          }),
        ),
      });
    }

    return {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      ...(request.system === undefined ? {} : { system: request.system }),
      messages,
      output_config: {
        ...(request.effort === undefined ? {} : { effort: request.effort }),
        // Structured outputs and citations cannot be combined in one request,
        // which the port's two kinds already keep apart.
        ...(request.kind === 'structured'
          ? { format: { type: 'json_schema', schema: request.schema } }
          : {}),
      },
    };
  }

  private toResult(
    request: LanguageModelRequest,
    message: Anthropic.Message,
  ): LanguageModelResult {
    const usage = toUsage(message.usage);

    if (message.stop_reason === 'refusal') {
      return {
        outcome: 'refused',
        category: message.stop_details?.category ?? null,
        usage,
      };
    }

    let text = '';
    const citations: LanguageModelCitation[] = [];
    for (const block of message.content) {
      if (block.type !== 'text') continue;
      text += block.text;
      if (request.kind !== 'cited') continue;
      for (const citation of block.citations ?? []) {
        if (!('document_index' in citation)) continue;
        const source = request.sources[citation.document_index];
        if (source) {
          citations.push({ sourceId: source.id, quote: citation.cited_text });
        }
      }
    }

    const truncated = message.stop_reason === 'max_tokens';
    if (request.kind !== 'structured') {
      return { outcome: 'completed', text, citations, truncated, usage };
    }

    let object: unknown;
    try {
      object = JSON.parse(text);
    } catch {
      // Cut off at the output ceiling, most likely. The gateway reports it as
      // invalid output; the text is not attached to the error.
      throw new LanguageModelError('invalid_output', 'anthropic');
    }
    return { outcome: 'completed', text, object, citations, truncated, usage };
  }
}

function toUsage(usage: Anthropic.Usage): LanguageModelUsage {
  const cached = usage.cache_read_input_tokens ?? 0;
  return {
    // The API reports uncached, cache-written and cache-read input apart.
    inputTokens:
      usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cached,
    outputTokens: usage.output_tokens,
    cachedInputTokens: cached,
  };
}

/**
 * Map an SDK error to the port's error, keeping only its class, status and
 * request id. The SDK's message is dropped: a 400 can quote the request.
 */
function toLanguageModelError(error: unknown): LanguageModelError {
  if (error instanceof LanguageModelError) return error;
  const fail = (kind: LanguageModelErrorKind): LanguageModelError =>
    new LanguageModelError(
      kind,
      'anthropic',
      error instanceof Anthropic.APIError
        ? {
            status: typeof error.status === 'number' ? error.status : undefined,
            requestId: error.requestID ?? undefined,
          }
        : {},
    );

  if (error instanceof Anthropic.APIUserAbortError) return fail('aborted');
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return fail('timeout');
  }
  if (error instanceof Anthropic.APIConnectionError) return fail('connection');
  if (error instanceof Anthropic.RateLimitError) return fail('rate_limited');
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return fail('auth');
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return fail('invalid_request');
  }
  if (error instanceof Anthropic.InternalServerError) return fail('overloaded');
  return fail('unknown');
}
