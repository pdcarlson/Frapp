import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import {
  LanguageModelError,
  type EmbeddingResult,
  type ILanguageModel,
  type LanguageModelCitation,
  type LanguageModelErrorKind,
  type AgentLanguageModelRequest,
  type LanguageModelRequest,
  type LanguageModelResult,
  type LanguageModelSource,
  type LanguageModelStreamEvent,
  type LanguageModelToolCall,
  type LanguageModelToolResult,
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
 * - No tool runner. An `agent` request is one round: the model's calls come
 *   back to the caller, which runs them and asks again (#4899).
 *
 * How an `agent` round is built:
 * - A tool's result goes back as `search_result` blocks, one per source, with
 *   citations on, so the answer cites what a tool read through the same
 *   mechanism a `cited` request uses. A citation of one names the block's
 *   `source`, which is Frapp's source id. The smallest thing the provider
 *   cites there is a whole text block, so a source is sent as one block per
 *   line: a quote is then a line or a run of lines, and is word for word in
 *   the source's text, which is what the gateway checks.
 * - The model's own turn is passed back exactly as it came (`replay`),
 *   thinking blocks included: the API rejects a tool result whose turn was
 *   edited.
 * - With `cache`, the tools and system text, and the rounds so far, are
 *   marked for the provider's prompt cache. That is a cache of the request's
 *   own prefix for a few minutes, not a stored document or thread.
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
    if (request.kind === 'agent') return agentParams(request);

    const messages: Anthropic.MessageParam[] = request.messages.map(
      (message) => ({ role: message.role, content: message.content }),
    );

    if (request.kind === 'cited' && request.sources.length > 0) {
      // With no sources this is a plain prose call: an empty document message
      // would be rejected by the API. Sources go in as documents with citations on, ahead of the
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
          ? {
              format: {
                type: 'json_schema',
                schema: toProviderSchema(request.schema),
              },
            }
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
    const toolCalls: LanguageModelToolCall[] = [];
    for (const block of message.content) {
      if (block.type === 'tool_use' && request.kind === 'agent') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
      if (block.type !== 'text') continue;
      text += block.text;
      if (request.kind === 'agent') {
        for (const citation of block.citations ?? []) {
          if (citation.type !== 'search_result_location') continue;
          // `source` is the id the result's block was sent under.
          citations.push({
            sourceId: citation.source,
            quote: citation.cited_text,
            at: text.length,
          });
        }
        continue;
      }
      if (request.kind !== 'cited') continue;
      for (const citation of block.citations ?? []) {
        if (!('document_index' in citation)) continue;
        const source = request.sources[citation.document_index];
        if (source) {
          // `at`: the end of the span of prose this citation arrived on.
          citations.push({
            sourceId: source.id,
            quote: citation.cited_text,
            at: text.length,
          });
        }
      }
    }

    const truncated = message.stop_reason === 'max_tokens';
    if (request.kind === 'agent') {
      return {
        outcome: 'completed',
        text,
        citations,
        // A turn cut off at the ceiling may hold half a call; none is run.
        toolCalls: truncated ? [] : toolCalls,
        replay: message.content,
        truncated,
        usage,
      };
    }
    if (request.kind !== 'structured') {
      return { outcome: 'completed', text, citations, truncated, usage };
    }

    let object: unknown;
    try {
      object = JSON.parse(text);
    } catch {
      // Cut off at the output ceiling, most likely. The gateway reports it as
      // invalid output; the text is not attached to the error. The reply was
      // still generated and billed, so its token counts go with the error.
      throw new LanguageModelError('invalid_output', 'anthropic', { usage });
    }
    return { outcome: 'completed', text, object, citations, truncated, usage };
  }
}

const CACHED = { cache_control: { type: 'ephemeral' as const } };

/** One round of a tool loop, as the Messages API takes it. */
function agentParams(
  request: AgentLanguageModelRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  const messages: Anthropic.MessageParam[] = request.messages.map(
    (message, index): Anthropic.MessageParam => {
      const last = index === request.messages.length - 1;
      if (!last || message.role !== 'user' || request.context.length === 0) {
        return { role: message.role, content: message.content };
      }
      // What Frapp knows about this turn goes ahead of the question, as its
      // own blocks: read, and never something an answer can cite.
      return {
        role: 'user',
        content: [
          ...request.context.map((source): Anthropic.TextBlockParam => ({
            type: 'text',
            text: `${source.title}\n${source.text}`,
          })),
          { type: 'text', text: message.content },
        ],
      };
    },
  );

  request.rounds.forEach((round, index) => {
    const results = round.results.map(toolResultBlock);
    if (
      request.cache &&
      index === request.rounds.length - 1 &&
      results.length > 0
    ) {
      // Everything up to here is the same bytes next round.
      results[results.length - 1] = {
        ...results[results.length - 1],
        ...CACHED,
      };
    }
    messages.push(
      {
        role: 'assistant',
        content: round.replay as Anthropic.ContentBlockParam[],
      },
      { role: 'user', content: results },
    );
  });

  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    ...(request.system === undefined
      ? {}
      : {
          system: [
            {
              type: 'text',
              text: request.system,
              // Tools come before the system text in the cached prefix, so
              // this one mark covers both.
              ...(request.cache ? CACHED : {}),
            },
          ],
        }),
    messages,
    ...(request.tools.length === 0
      ? {}
      : {
          tools: request.tools.map((tool): Anthropic.Tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          })),
        }),
    output_config: {
      ...(request.effort === undefined ? {} : { effort: request.effort }),
    },
  };
}

function toolResultBlock(
  result: LanguageModelToolResult,
): Anthropic.ToolResultBlockParam {
  const content: Array<
    Anthropic.TextBlockParam | Anthropic.SearchResultBlockParam
  > = result.sources.map(searchResultBlock);
  if (result.note) content.push({ type: 'text', text: result.note });
  // An empty result is rejected by the API, and tells the model nothing.
  if (content.length === 0) content.push({ type: 'text', text: 'Nothing.' });
  return {
    type: 'tool_result',
    tool_use_id: result.callId,
    content,
    ...(result.failed ? { is_error: true } : {}),
  };
}

/**
 * A source as a citable block: one text block per line, each keeping its
 * line break, so the blocks joined are the source's text exactly.
 */
function searchResultBlock(
  source: LanguageModelSource,
): Anthropic.SearchResultBlockParam {
  // The API rejects a block of only white space, so a blank line rides with
  // the line beside it.
  const blocks: string[] = [];
  for (const piece of source.text.split(/(?<=\n)/)) {
    const last = blocks.length - 1;
    if (last >= 0 && (piece.trim() === '' || blocks[last].trim() === '')) {
      blocks[last] += piece;
    } else {
      blocks.push(piece);
    }
  }
  return {
    type: 'search_result',
    source: source.id,
    title: source.title,
    content: blocks.map((text) => ({
      type: 'text',
      text: text.trim() === '' ? '(empty)' : text,
    })),
    citations: { enabled: true },
  };
}

/**
 * The schema as structured outputs accepts it. The gateway hands over plain
 * JSON Schema, which can carry keywords the provider rejects (`minLength`,
 * `maximum`, `maxItems`, `$schema`). The SDK's own transform moves those into
 * each field's description, where the model still reads them. Nothing is
 * lost: the gateway parses the reply with the caller's schema again, so a
 * reply that breaks a moved constraint comes back as invalid output.
 */
function toProviderSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const rest = { ...schema };
  delete rest.$schema;
  return transformJSONSchema(rest);
}

/**
 * An error that arrives inside a stream has no HTTP status (the response
 * began as a 200), only the provider's error type.
 */
type AnthropicErrorType = NonNullable<
  InstanceType<typeof Anthropic.APIError>['type']
>;

const KIND_BY_ERROR_TYPE: Partial<
  Record<AnthropicErrorType, LanguageModelErrorKind>
> = {
  overloaded_error: 'overloaded',
  api_error: 'overloaded',
  rate_limit_error: 'rate_limited',
  timeout_error: 'timeout',
  authentication_error: 'auth',
  permission_error: 'auth',
  billing_error: 'auth',
  invalid_request_error: 'invalid_request',
  not_found_error: 'invalid_request',
};

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
  if (error instanceof Anthropic.APIError && error.type) {
    return fail(KIND_BY_ERROR_TYPE[error.type] ?? 'unknown');
  }
  return fail('unknown');
}
