import Anthropic from '@anthropic-ai/sdk';
import {
  LanguageModelError,
  type CitedLanguageModelRequest,
  type LanguageModelStreamEvent,
  type StructuredLanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import {
  AnthropicLanguageModel,
  type AnthropicMessagesClient,
} from './anthropic-language-model';

const SECRET = 'the treasurer owes $900';

const structured: StructuredLanguageModelRequest = {
  kind: 'structured',
  task: 'minutes.draft',
  model: 'claude-sonnet-5-5',
  system: 'Draft minutes.',
  messages: [{ role: 'user', content: SECRET }],
  maxOutputTokens: 16_000,
  effort: 'medium',
  schema: { type: 'object', properties: { title: { type: 'string' } } },
};

const cited: CitedLanguageModelRequest = {
  kind: 'cited',
  task: 'ask.answer',
  model: 'claude-sonnet-5-5',
  messages: [{ role: 'user', content: 'When is formal?' }],
  maxOutputTokens: 4000,
  effort: 'low',
  sources: [
    { id: 'doc-bylaws', title: 'Bylaws', text: 'Dues are $450.' },
    { id: 'doc-minutes', title: 'Minutes', text: 'Formal is April 12.' },
  ],
};

function message(overrides: Record<string, unknown>): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function clientReturning(reply: Anthropic.Message) {
  const create = jest.fn().mockResolvedValue(reply);
  const client = { messages: { create } } as unknown as AnthropicMessagesClient;
  return { create, model: new AnthropicLanguageModel(client) };
}

function clientThrowing(error: unknown) {
  const create = jest.fn().mockRejectedValue(error);
  const client = { messages: { create } } as unknown as AnthropicMessagesClient;
  return new AnthropicLanguageModel(client);
}

describe('AnthropicLanguageModel', () => {
  describe('a structured request', () => {
    it('uses structured outputs, the catalog effort, and nothing the model rejects', async () => {
      const { create, model } = clientReturning(
        message({ content: [{ type: 'text', text: '{"title":"Chapter"}' }] }),
      );

      const result = await model.generate(structured);

      const [params] = create.mock.calls[0] as [Record<string, unknown>];
      expect(params).toEqual({
        model: 'claude-sonnet-5-5',
        max_tokens: 16_000,
        system: 'Draft minutes.',
        messages: [{ role: 'user', content: SECRET }],
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            // The SDK's transform closes every object, as the provider requires.
            schema: { ...structured.schema, additionalProperties: false },
          },
        },
      });
      // Current Claude models reject each of these.
      for (const key of ['thinking', 'temperature', 'top_p', 'tool_choice']) {
        expect(params).not.toHaveProperty(key);
      }
      expect(result).toEqual({
        outcome: 'completed',
        text: '{"title":"Chapter"}',
        object: { title: 'Chapter' },
        citations: [],
        truncated: false,
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
      });
    });

    it('reports JSON cut off at the ceiling as invalid output, without the text', async () => {
      const { model } = clientReturning(
        message({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: `{"title":"${SECRET}` }],
        }),
      );
      const error = await model.generate(structured).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LanguageModelError);
      expect(error).toMatchObject({
        kind: 'invalid_output',
        // The reply was generated and billed, so the ledger gets its counts.
        details: {
          usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
        },
      });
      expect(JSON.stringify(error) + (error as Error).message).not.toContain(
        SECRET,
      );
    });

    it('moves the schema keywords structured outputs rejects into descriptions', async () => {
      const { create, model } = clientReturning(
        message({ content: [{ type: 'text', text: '{"title":"Chapter"}' }] }),
      );
      await model.generate({
        ...structured,
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 80 },
            items: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          },
          required: ['title', 'items'],
          additionalProperties: false,
        },
      });

      const [params] = create.mock.calls[0] as [
        { output_config: { format: { schema: Record<string, unknown> } } },
      ];
      const sent = params.output_config.format.schema;
      const wire = JSON.stringify(sent);
      for (const keyword of ['$schema', '"minLength"', '"maxItems"']) {
        expect(wire).not.toContain(keyword);
      }
      expect(sent).toMatchObject({
        type: 'object',
        required: ['title', 'items'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: expect.any(String) as string },
        },
      });
    });
  });

  describe('a cited request', () => {
    it('sends the sources as documents with citations on, ahead of the question', async () => {
      const { create, model } = clientReturning(
        message({ content: [{ type: 'text', text: 'ok' }] }),
      );
      await model.generate(cited);

      const [params] = create.mock.calls[0] as [Anthropic.MessageCreateParams];
      expect(params.messages).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: 'Dues are $450.',
              },
              title: 'Bylaws',
              citations: { enabled: true },
            },
            {
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: 'Formal is April 12.',
              },
              title: 'Minutes',
              citations: { enabled: true },
            },
          ],
        },
        { role: 'user', content: 'When is formal?' },
      ]);
      // Citations and structured outputs cannot share a request.
      expect(params.output_config).toEqual({ effort: 'low' });
    });

    it('sends no document message when there are no sources', async () => {
      const { create, model } = clientReturning(
        message({ content: [{ type: 'text', text: 'I do not know.' }] }),
      );
      await model.generate({ ...cited, sources: [] });
      const [params] = create.mock.calls[0] as [{ messages: unknown[] }];
      expect(params.messages).toEqual([
        { role: 'user', content: 'When is formal?' },
      ]);
    });

    it('maps each citation back to the source it indexes', async () => {
      const { model } = clientReturning(
        message({
          content: [
            { type: 'text', text: 'Formal is ' },
            {
              type: 'text',
              text: 'April 12.',
              citations: [
                {
                  type: 'char_location',
                  document_index: 1,
                  cited_text: 'Formal is April 12.',
                  start_char_index: 0,
                  end_char_index: 19,
                },
                // An index outside the request is not any source of ours.
                {
                  type: 'char_location',
                  document_index: 7,
                  cited_text: 'made up',
                  start_char_index: 0,
                  end_char_index: 7,
                },
              ],
            },
          ],
        }),
      );

      await expect(model.generate(cited)).resolves.toMatchObject({
        text: 'Formal is April 12.',
        citations: [{ sourceId: 'doc-minutes', quote: 'Formal is April 12.' }],
      });
    });
  });

  it('returns a refusal as a result, with what it cost', async () => {
    const { model } = clientReturning(
      message({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
    );
    await expect(model.generate(cited)).resolves.toEqual({
      outcome: 'refused',
      category: 'cyber',
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
    });
  });

  it('marks output that hit the ceiling as truncated', async () => {
    const { model } = clientReturning(
      message({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: 'Half an' }],
      }),
    );
    await expect(model.generate(cited)).resolves.toMatchObject({
      truncated: true,
    });
  });

  it('counts cache writes and reads as input, and reads as cached', async () => {
    const { model } = clientReturning(
      message({
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 3000,
        },
      }),
    );
    await expect(model.generate(cited)).resolves.toMatchObject({
      usage: { inputTokens: 3210, outputTokens: 5, cachedInputTokens: 3000 },
    });
  });

  it('streams text deltas, then the whole result', async () => {
    const final = message({
      content: [{ type: 'text', text: 'Formal is April 12.' }],
    });
    const stream = {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Formal is ' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'x' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'April 12.' },
        };
      },
      finalMessage: () => Promise.resolve(final),
    };
    const client = {
      messages: { stream: jest.fn().mockReturnValue(stream) },
    } as unknown as AnthropicMessagesClient;

    const events: LanguageModelStreamEvent[] = [];
    for await (const event of new AnthropicLanguageModel(client).stream(
      cited,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', delta: 'Formal is ' },
      { type: 'text', delta: 'April 12.' },
      {
        type: 'done',
        result: expect.objectContaining({
          text: 'Formal is April 12.',
        }) as unknown,
      },
    ]);
  });

  it('has no embedding model', async () => {
    const { model } = clientReturning(message({}));
    await expect(model.embed()).rejects.toMatchObject({ kind: 'unsupported' });
  });

  describe('a provider error', () => {
    const headers = new Headers({ 'request-id': 'req_123' });
    // A 400 quotes the request back, which is why the message is dropped.
    const body = {
      type: 'error',
      error: { type: 'x', message: `bad: ${SECRET}` },
    };

    it.each([
      [400, 'invalid_request', false],
      [401, 'auth', false],
      [403, 'auth', false],
      [404, 'invalid_request', false],
      [422, 'invalid_request', false],
      [429, 'rate_limited', true],
      [500, 'overloaded', true],
      [529, 'overloaded', true],
    ])('maps HTTP %i to %s', async (status, kind, retryable) => {
      const sdkError = Anthropic.APIError.generate(
        status,
        body,
        `bad: ${SECRET}`,
        headers,
      );
      const error = await clientThrowing(sdkError)
        .generate(structured)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LanguageModelError);
      expect(error).toMatchObject({
        kind,
        retryable,
        provider: 'anthropic',
        details: { status, requestId: 'req_123' },
      });
    });

    it('keeps nothing the provider said', async () => {
      const sdkError = Anthropic.APIError.generate(
        400,
        body,
        `bad: ${SECRET}`,
        headers,
      );
      const error = (await clientThrowing(sdkError)
        .generate(structured)
        .catch((e: unknown) => e)) as LanguageModelError;

      expect(error.message).toBe(
        'AI provider call failed: invalid_request (status 400)',
      );
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(error) + String(error.stack)).not.toContain(SECRET);
    });

    it('maps a dropped connection, a timeout and an abort', async () => {
      await expect(
        clientThrowing(
          new Anthropic.APIConnectionError({ message: 'x' }),
        ).generate(cited),
      ).rejects.toMatchObject({ kind: 'connection', retryable: true });
      await expect(
        clientThrowing(new Anthropic.APIConnectionTimeoutError()).generate(
          cited,
        ),
      ).rejects.toMatchObject({ kind: 'timeout', retryable: true });
      await expect(
        clientThrowing(new Anthropic.APIUserAbortError()).generate(cited),
      ).rejects.toMatchObject({ kind: 'aborted', retryable: false });
    });

    it.each([
      ['overloaded_error', 'overloaded', true],
      ['rate_limit_error', 'rate_limited', true],
      ['api_error', 'overloaded', true],
      ['invalid_request_error', 'invalid_request', false],
    ])(
      'maps a %s that arrives inside a stream, where there is no status',
      async (type, kind, retryable) => {
        // What the SDK throws for an `error` event after a 200 has begun.
        const sdkError = new Anthropic.APIError(
          undefined,
          { type: 'error', error: { type, message: `bad: ${SECRET}` } },
          undefined,
          undefined,
          type as InstanceType<typeof Anthropic.APIError>['type'],
        );
        const error = await clientThrowing(sdkError)
          .generate(cited)
          .catch((e: unknown) => e);
        expect(error).toMatchObject({ kind, retryable });
        expect((error as Error).message).not.toContain(SECRET);
      },
    );

    it('replaces anything else with an unknown failure', async () => {
      const error = await clientThrowing(new TypeError(`cannot read ${SECRET}`))
        .generate(cited)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'unknown' });
      expect((error as Error).message).not.toContain(SECRET);
    });
  });
});
