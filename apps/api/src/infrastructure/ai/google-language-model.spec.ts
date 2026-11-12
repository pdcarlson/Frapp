import {
  ApiError,
  BlockedReason,
  FinishReason,
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from '@google/genai';
import {
  LanguageModelError,
  type CitedLanguageModelRequest,
  type LanguageModelStreamEvent,
  type StructuredLanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import {
  GoogleLanguageModel,
  type GoogleModelsClient,
} from './google-language-model';

const SECRET = 'the treasurer owes $900';

const structured: StructuredLanguageModelRequest = {
  kind: 'structured',
  task: 'minutes.draft',
  model: 'gemini-3.8-flash',
  system: 'Draft minutes.',
  messages: [{ role: 'user', content: SECRET }],
  maxOutputTokens: 16_000,
  effort: 'medium',
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { title: { type: 'string' } },
  },
};

const cited: CitedLanguageModelRequest = {
  kind: 'cited',
  task: 'ask.answer',
  model: 'gemini-3.8-flash',
  messages: [{ role: 'user', content: 'When is formal?' }],
  maxOutputTokens: 4000,
  effort: 'low',
  sources: [
    { id: 'doc-bylaws', title: 'Bylaws', text: 'Dues are $450.' },
    {
      id: 'doc-minutes',
      title: 'Minutes "spring"',
      text: 'Formal is April 12.',
    },
  ],
};

function response(fields: Record<string, unknown>): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), {
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 5,
      cachedContentTokenCount: 40,
    },
    ...fields,
  });
}

function textCandidate(text: string, finishReason = FinishReason.STOP) {
  return [{ content: { role: 'model', parts: [{ text }] }, finishReason }];
}

function clientWith(models: Partial<GoogleModelsClient['models']>) {
  return new GoogleLanguageModel({ models } as GoogleModelsClient);
}

describe('GoogleLanguageModel', () => {
  describe('the client it builds', () => {
    it('is the paid cloud platform with a service account, never an API key', () => {
      const previous = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'unit-test-value';
      try {
        const model = GoogleLanguageModel.fromSettings({
          project: 'frapp-ai-staging',
          location: 'global',
          credentials: {
            type: 'service_account',
            client_email: 'unit-test@example.invalid',
            private_key: 'unit-test-value',
          },
        });
        const client = (model as unknown as { client: GoogleGenAI }).client;
        expect(client.vertexai).toBe(true);
        // The SDK drops an environment key when a project is given.
        expect(
          (client as unknown as { apiKey?: string }).apiKey,
        ).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previous;
      }
    });
  });

  describe('a structured request', () => {
    it('uses JSON mode with the schema, the thinking level, and no sampling settings', async () => {
      const generateContent = jest
        .fn()
        .mockResolvedValue(
          response({ candidates: textCandidate('{"title":"Chapter"}') }),
        );
      const result = await clientWith({ generateContent }).generate(structured);

      const [params] = generateContent.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(params).toEqual({
        model: 'gemini-3.8-flash',
        contents: [{ role: 'user', parts: [{ text: SECRET }] }],
        config: {
          maxOutputTokens: 16_000,
          systemInstruction: 'Draft minutes.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
          },
        },
      });
      expect(result).toEqual({
        outcome: 'completed',
        text: '{"title":"Chapter"}',
        object: { title: 'Chapter' },
        citations: [],
        truncated: false,
        // Thinking is billed as output.
        usage: { inputTokens: 100, outputTokens: 25, cachedInputTokens: 40 },
      });
    });

    it('reports JSON cut off at the ceiling as invalid output, with its cost and without the text', async () => {
      const generateContent = jest.fn().mockResolvedValue(
        response({
          candidates: textCandidate(
            `{"title":"${SECRET}`,
            FinishReason.MAX_TOKENS,
          ),
        }),
      );
      const error = await clientWith({ generateContent })
        .generate(structured)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LanguageModelError);
      expect(error).toMatchObject({
        kind: 'invalid_output',
        provider: 'google',
        details: {
          usage: { inputTokens: 100, outputTokens: 25, cachedInputTokens: 40 },
        },
      });
      expect(JSON.stringify(error) + (error as Error).message).not.toContain(
        SECRET,
      );
    });
  });

  describe('a cited request', () => {
    it('sends numbered sources first and maps quotes back to Frapp ids', async () => {
      const generateContent = jest.fn().mockResolvedValue(
        response({
          candidates: textCandidate(
            JSON.stringify({
              answer: 'Formal is April 12.',
              citations: [
                { source: 2, quote: 'Formal is April 12.' },
                // A number that names no source goes nowhere.
                { source: 9, quote: 'Made up.' },
                { source: 'one', quote: 'Wrong shape.' },
              ],
            }),
          ),
        }),
      );
      const result = await clientWith({ generateContent }).generate(cited);

      const [params] = generateContent.mock.calls[0] as [
        {
          contents: Array<{ role: string; parts: Array<{ text: string }> }>;
          config: Record<string, unknown>;
        },
      ];
      expect(params.contents).toHaveLength(2);
      const sources = params.contents[0].parts[0].text;
      expect(sources).toContain('<source number="1" title="Bylaws">');
      expect(sources).toContain('Dues are $450.');
      // A title cannot close its own tag.
      expect(sources).toContain('title="Minutes &#34;spring&#34;"');
      expect(params.contents[1]).toEqual({
        role: 'user',
        parts: [{ text: 'When is formal?' }],
      });
      expect(params.config.responseMimeType).toBe('application/json');
      expect(params.config.thinkingConfig).toEqual({
        thinkingLevel: ThinkingLevel.LOW,
      });

      expect(result).toMatchObject({
        outcome: 'completed',
        text: 'Formal is April 12.',
        citations: [{ sourceId: 'doc-minutes', quote: 'Formal is April 12.' }],
      });
    });

    it('is plain prose when there are no sources', async () => {
      const generateContent = jest
        .fn()
        .mockResolvedValue(response({ candidates: textCandidate('Hello.') }));
      const result = await clientWith({ generateContent }).generate({
        ...cited,
        sources: [],
      });
      const [params] = generateContent.mock.calls[0] as [
        { config: Record<string, unknown> },
      ];
      expect(params.config).not.toHaveProperty('responseMimeType');
      expect(result).toMatchObject({ text: 'Hello.', citations: [] });
    });

    it('treats a reply that is not the answer shape as invalid output', async () => {
      const generateContent = jest
        .fn()
        .mockResolvedValue(
          response({ candidates: textCandidate('{"text":"no"}') }),
        );
      await expect(
        clientWith({ generateContent }).generate(cited),
      ).rejects.toMatchObject({ kind: 'invalid_output' });
    });
  });

  describe('refusals', () => {
    it('reads a blocked prompt as a refusal with its category', async () => {
      const generateContent = jest.fn().mockResolvedValue(
        response({
          candidates: [],
          promptFeedback: { blockReason: BlockedReason.PROHIBITED_CONTENT },
        }),
      );
      await expect(
        clientWith({ generateContent }).generate(structured),
      ).resolves.toMatchObject({
        outcome: 'refused',
        category: 'prohibited_content',
        usage: { inputTokens: 100 },
      });
    });

    it('reads a safety stop as a refusal', async () => {
      const generateContent = jest
        .fn()
        .mockResolvedValue(
          response({ candidates: textCandidate('', FinishReason.SAFETY) }),
        );
      await expect(
        clientWith({ generateContent }).generate(cited),
      ).resolves.toMatchObject({ outcome: 'refused', category: 'safety' });
    });

    it('reads an empty reply with no reason as invalid output', async () => {
      const generateContent = jest
        .fn()
        .mockResolvedValue(response({ candidates: [] }));
      await expect(
        clientWith({ generateContent }).generate(structured),
      ).rejects.toMatchObject({ kind: 'invalid_output' });
    });
  });

  describe('errors', () => {
    it.each([
      [429, 'rate_limited', true],
      [403, 'auth', false],
      [400, 'invalid_request', false],
      [503, 'overloaded', true],
      [504, 'timeout', true],
    ] as const)(
      'maps status %d to %s, dropping the message',
      async (status, kind, retryable) => {
        const generateContent = jest
          .fn()
          .mockRejectedValue(
            new ApiError({ status, message: `request echoed: ${SECRET}` }),
          );
        const error = (await clientWith({ generateContent })
          .generate(structured)
          .catch((e: unknown) => e)) as LanguageModelError;
        expect(error).toBeInstanceOf(LanguageModelError);
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(retryable);
        expect(error.details.status).toBe(status);
        expect(error.message).not.toContain(SECRET);
        expect(error.cause).toBeUndefined();
      },
    );

    it('maps an abort and a dropped connection', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      await expect(
        clientWith({
          generateContent: jest.fn().mockRejectedValue(abort),
        }).generate(structured),
      ).rejects.toMatchObject({ kind: 'aborted' });
      await expect(
        clientWith({
          generateContent: jest
            .fn()
            .mockRejectedValue(new TypeError('fetch failed')),
        }).generate(structured),
      ).rejects.toMatchObject({ kind: 'connection' });
    });
  });

  describe('streaming', () => {
    async function collect(
      events: AsyncIterable<LanguageModelStreamEvent>,
    ): Promise<LanguageModelStreamEvent[]> {
      const out: LanguageModelStreamEvent[] = [];
      for await (const event of events) out.push(event);
      return out;
    }

    it('streams prose as it arrives, then one done with the usage', async () => {
      async function* chunks() {
        yield response({
          candidates: textCandidate(
            'Formal ',
            FinishReason.FINISH_REASON_UNSPECIFIED,
          ),
          usageMetadata: undefined,
        });
        yield response({ candidates: textCandidate('is in April.') });
      }
      const generateContentStream = jest.fn().mockResolvedValue(chunks());
      const events = await collect(
        clientWith({ generateContentStream }).stream({ ...cited, sources: [] }),
      );
      expect(events).toEqual([
        { type: 'text', delta: 'Formal ' },
        { type: 'text', delta: 'is in April.' },
        {
          type: 'done',
          result: {
            outcome: 'completed',
            text: 'Formal is in April.',
            citations: [],
            truncated: false,
            usage: {
              inputTokens: 100,
              outputTokens: 25,
              cachedInputTokens: 40,
            },
          },
        },
      ]);
    });

    it('answers a cited request with sources in one piece, never as raw JSON', async () => {
      const generateContent = jest.fn().mockResolvedValue(
        response({
          candidates: textCandidate(
            JSON.stringify({
              answer: 'Dues are $450.',
              citations: [{ source: 1, quote: 'Dues are $450.' }],
            }),
          ),
        }),
      );
      const events = await collect(
        clientWith({ generateContent }).stream(cited),
      );
      expect(events[0]).toEqual({ type: 'text', delta: 'Dues are $450.' });
      expect(events[1]).toMatchObject({
        type: 'done',
        result: {
          citations: [{ sourceId: 'doc-bylaws', quote: 'Dues are $450.' }],
        },
      });
    });
  });

  describe('embeddings', () => {
    it('asks for the catalog width, one text a request, and returns unit vectors in order', async () => {
      const embedContent = jest
        .fn()
        .mockImplementation(({ contents }: { contents: string }) =>
          Promise.resolve({
            embeddings: [
              {
                values: contents === 'a' ? [3, 4, 0] : [0, 0, 2],
                statistics: { tokenCount: 7 },
              },
            ],
          }),
        );
      const result = await clientWith({ embedContent }).embed({
        task: 'corpus.embed',
        model: 'gemini-embedding-001',
        texts: ['a', 'b'],
        dimensions: 3,
      });
      expect(embedContent).toHaveBeenCalledTimes(2);
      expect(embedContent.mock.calls[0][0]).toEqual({
        model: 'gemini-embedding-001',
        contents: 'a',
        config: { outputDimensionality: 3 },
      });
      expect(result).toEqual({
        vectors: [
          [0.6, 0.8, 0],
          [0, 0, 1],
        ],
        inputTokens: 14,
      });
    });

    it('treats a vector of the wrong width as invalid output', async () => {
      const embedContent = jest
        .fn()
        .mockResolvedValue({ embeddings: [{ values: [1, 2] }] });
      await expect(
        clientWith({ embedContent }).embed({
          task: 'corpus.embed',
          model: 'gemini-embedding-001',
          texts: ['a'],
          dimensions: 1536,
        }),
      ).rejects.toMatchObject({ kind: 'invalid_output', provider: 'google' });
    });
  });
});
