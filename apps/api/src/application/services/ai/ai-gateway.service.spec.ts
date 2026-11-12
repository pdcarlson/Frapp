import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { assertContentFreeProperties } from '@repo/validation';
import { z } from 'zod';
import type { IAiConsentCheck } from '#domain/adapters/ai-consent-check.interface';
import type { IAiSpendReservation } from '#domain/adapters/ai-spend-reservation.interface';
import type {
  AiUsageRecord,
  IAiUsageRecorder,
} from '#domain/adapters/ai-usage-recorder.interface';
import {
  LanguageModelError,
  type ILanguageModel,
  type ILanguageModelRegistry,
  type LanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import {
  ScriptedLanguageModel,
  type ScriptedReplies,
} from '../../../infrastructure/ai/scripted-language-model';
import { buildSentryOptions } from '../../../infrastructure/observability/sentry-options';
import type { AnalyticsService } from '../analytics.service';
import {
  AiGatewayService,
  type AiCitedStreamEvent,
} from './ai-gateway.service';
import {
  AI_CALL_EVENT,
  AiTelemetryService,
  type IAiTelemetry,
} from './ai-telemetry.service';

const CONTEXT = { chapterId: 'chapter-1', actingUserId: 'user-1' };
const BYLAWS = { id: 'doc-bylaws', title: 'Bylaws', text: 'Dues are $450.' };
const MINUTES = {
  id: 'doc-minutes',
  title: 'Minutes',
  text: 'Formal is April 12.',
};
const ASK = {
  promptVersion: 'ask@v1',
  messages: [{ role: 'user' as const, content: 'When is formal?' }],
  sources: [BYLAWS, MINUTES],
};
const DraftSchema = z.object({
  title: z.string(),
  motions: z.array(z.string()),
});
const DRAFT = {
  promptVersion: 'minutes-draft@v1',
  system: 'Draft minutes.',
  messages: [{ role: 'user' as const, content: 'notes' }],
  schema: DraftSchema,
};

interface Harness {
  gateway: AiGatewayService;
  steps: string[];
  records: AiUsageRecord[];
  requests: LanguageModelRequest[];
  consent: jest.Mocked<IAiConsentCheck>;
  spend: jest.Mocked<IAiSpendReservation>;
  recorder: jest.Mocked<IAiUsageRecorder>;
  telemetry: jest.Mocked<IAiTelemetry>;
  registry: jest.Mocked<ILanguageModelRegistry>;
}

function harness(
  scripts: ScriptedReplies = {},
  options: { model?: ILanguageModel | null } = {},
): Harness {
  const steps: string[] = [];
  const records: AiUsageRecord[] = [];
  const requests: LanguageModelRequest[] = [];

  const scripted = new ScriptedLanguageModel(
    Object.fromEntries(
      Object.entries(scripts).map(([task, handler]) => [
        task,
        (request: LanguageModelRequest) => {
          steps.push('model');
          requests.push(request);
          return handler(request);
        },
      ]),
    ),
  );
  const model = options.model === undefined ? scripted : options.model;

  const registry: jest.Mocked<ILanguageModelRegistry> = {
    resolve: jest.fn().mockReturnValue(model),
  };
  const consent: jest.Mocked<IAiConsentCheck> = {
    check: jest.fn().mockImplementation(() => {
      steps.push('consent');
      return Promise.resolve({ allowed: true });
    }),
  };
  const spend: jest.Mocked<IAiSpendReservation> = {
    reserve: jest.fn().mockImplementation(() => {
      steps.push('reserve');
      return Promise.resolve({ granted: true, reservationId: 'res-1' });
    }),
  };
  const recorder: jest.Mocked<IAiUsageRecorder> = {
    record: jest.fn().mockImplementation((record: AiUsageRecord) => {
      steps.push('record');
      records.push(record);
      return Promise.resolve();
    }),
  };
  const telemetry: jest.Mocked<IAiTelemetry> = {
    inSpan: jest
      .fn()
      .mockImplementation((_call, run: () => Promise<unknown>) =>
        run(),
      ) as jest.Mocked<IAiTelemetry>['inSpan'],
    callFinished: jest.fn().mockImplementation(() => {
      steps.push('event');
      return Promise.resolve();
    }),
  };

  return {
    gateway: new AiGatewayService(
      registry,
      consent,
      spend,
      recorder,
      telemetry,
    ),
    steps,
    records,
    requests,
    consent,
    spend,
    recorder,
    telemetry,
    registry,
  };
}

async function collect(
  stream: AsyncIterable<AiCitedStreamEvent>,
): Promise<AiCitedStreamEvent[]> {
  const events: AiCitedStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('AiGatewayService', () => {
  const originalEnabled = process.env.AI_ENABLED;
  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
  });
  afterAll(() => {
    if (originalEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = originalEnabled;
  });

  describe('deciding whether a call is made', () => {
    it.each([undefined, 'false'])(
      'makes no call and asks no seam when AI_ENABLED is %p',
      async (value) => {
        if (value === undefined) delete process.env.AI_ENABLED;
        else process.env.AI_ENABLED = value;
        const h = harness();

        await expect(
          h.gateway.generateCited('ask.answer', ASK, CONTEXT),
        ).resolves.toEqual({ status: 'unavailable', reason: 'disabled' });
        await expect(
          h.gateway.generateObject('minutes.draft', DRAFT, CONTEXT),
        ).resolves.toEqual({ status: 'unavailable', reason: 'disabled' });
        await expect(
          h.gateway.embed(
            'corpus.embed',
            { texts: ['a'], promptVersion: 'embed@v1' },
            CONTEXT,
          ),
        ).resolves.toEqual({ status: 'unavailable', reason: 'disabled' });
        await expect(
          collect(h.gateway.streamCited('ask.answer', ASK, CONTEXT)),
        ).resolves.toEqual([
          {
            type: 'end',
            result: { status: 'unavailable', reason: 'disabled' },
          },
        ]);

        expect(h.registry.resolve).not.toHaveBeenCalled();
        expect(h.steps).toEqual([]);
      },
    );

    it('is not available when the task has no adapter here, before asking any seam', async () => {
      const h = harness({}, { model: null });
      await expect(
        h.gateway.generateCited('ask.answer', ASK, CONTEXT),
      ).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
      expect(h.registry.resolve).toHaveBeenCalledWith('anthropic');
      expect(h.steps).toEqual([]);
    });

    it('routes a task to the provider the catalog names', async () => {
      const h = harness();
      await h.gateway.embed(
        'corpus.embed',
        { texts: ['a'], promptVersion: 'embed@v1' },
        CONTEXT,
      );
      expect(h.registry.resolve).toHaveBeenCalledWith('google');
    });

    it.each(['chapter_off', 'member_declined'] as const)(
      'stops at consent (%s): nothing reserved, sent or recorded',
      async (reason) => {
        const h = harness({ 'ask.answer': () => ({ text: 'x' }) });
        h.consent.check.mockResolvedValue({ allowed: false, reason });

        await expect(
          h.gateway.generateCited('ask.answer', ASK, CONTEXT),
        ).resolves.toEqual({
          status: 'unavailable',
          reason: 'consent',
          detail: reason,
        });
        expect(h.spend.reserve).not.toHaveBeenCalled();
        expect(h.steps).toEqual([]);
      },
    );

    it.each(['chapter_cap', 'platform_cap'] as const)(
      'stops at the caps (%s): nothing sent or recorded',
      async (reason) => {
        const h = harness({ 'ask.answer': () => ({ text: 'x' }) });
        h.spend.reserve.mockResolvedValue({ granted: false, reason });

        await expect(
          h.gateway.generateCited('ask.answer', ASK, CONTEXT),
        ).resolves.toEqual({
          status: 'unavailable',
          reason: 'spend_cap',
          detail: reason,
        });
        expect(h.steps).toEqual(['consent']);
        expect(h.recorder.record).not.toHaveBeenCalled();
      },
    );

    it('refuses a task asked for the wrong kind of result', async () => {
      const h = harness();
      await expect(
        h.gateway.generateCited('minutes.draft' as never, ASK, CONTEXT),
      ).rejects.toThrow('AI task minutes.draft is structured, not cited');
      expect(h.steps).toEqual([]);
    });
  });

  describe('a call that is made', () => {
    it('runs consent, the reservation, the model, the ledger, then the event', async () => {
      const h = harness({ 'ask.answer': () => ({ text: 'April 12.' }) });
      await h.gateway.generateCited('ask.answer', ASK, CONTEXT);
      expect(h.steps).toEqual([
        'consent',
        'reserve',
        'model',
        'record',
        'event',
      ]);
    });

    it('describes the call to each seam from the catalog, with no text', async () => {
      const h = harness({ 'ask.answer': () => ({ text: 'April 12.' }) });
      await h.gateway.generateCited('ask.answer', ASK, {
        ...CONTEXT,
        runId: 'run-9',
      });

      const call = {
        chapterId: 'chapter-1',
        actingUserId: 'user-1',
        runId: 'run-9',
        task: 'ask.answer',
        family: 'ask',
        // The adapter that answered, which here is the scripted one: a canned
        // reply is not recorded as Anthropic's.
        provider: 'scripted',
        model: 'claude-sonnet-5-5',
        promptVersion: 'ask@v1',
      };
      expect(h.consent.check).toHaveBeenCalledWith(call);
      // "When is formal?" + both sources, at four characters a token; the
      // ceiling is the catalog's 4,000 at $10/M on top of the input at $2/M.
      expect(h.spend.reserve).toHaveBeenCalledWith(call, {
        inputTokens: 13,
        maxOutputTokens: 4000,
        maxCostMicroUsd: 40_026,
      });
      expect(h.records).toEqual([
        {
          ...call,
          reservationId: 'res-1',
          outcome: 'completed',
          errorKind: null,
          inputTokens: 13,
          outputTokens: 3,
          cachedInputTokens: 0,
          costMicroUsd: 56,
          latencyMs: expect.any(Number) as number,
        },
      ]);
      expect(h.telemetry.callFinished).toHaveBeenCalledWith(h.records[0], {
        kind: 'cited',
        streamed: false,
        citationsKept: 0,
        citationsDropped: 0,
      });
    });

    it('builds the request from the catalog, not from the caller', async () => {
      const h = harness({ 'ask.answer': () => ({ text: 'x' }) });
      await h.gateway.generateCited('ask.answer', ASK, CONTEXT);
      expect(h.requests[0]).toEqual({
        kind: 'cited',
        task: 'ask.answer',
        model: 'claude-sonnet-5-5',
        messages: ASK.messages,
        maxOutputTokens: 4000,
        effort: 'low',
        sources: [BYLAWS, MINUTES],
      });
    });
  });

  describe('generateObject', () => {
    it('returns the value the schema parsed, and sends the schema as JSON Schema', async () => {
      const h = harness({
        'minutes.draft': () => ({
          text: '{}',
          object: { title: 'Chapter', motions: ['Adjourn'] },
        }),
      });

      const result = await h.gateway.generateObject(
        'minutes.draft',
        DRAFT,
        CONTEXT,
      );

      expect(result).toEqual({
        status: 'ok',
        value: { title: 'Chapter', motions: ['Adjourn'] },
        usage: expect.any(Object) as unknown,
      });
      expect(h.requests[0]).toMatchObject({
        kind: 'structured',
        system: 'Draft minutes.',
        maxOutputTokens: 16_000,
        effort: 'medium',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            motions: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'motions'],
        },
      });
      expect(h.records[0]).toMatchObject({ outcome: 'completed' });
    });

    it('answers invalid_output when the value does not match, and still records the cost', async () => {
      const h = harness({
        'minutes.draft': () => ({ text: '{}', object: { title: 7 } }),
      });
      await expect(
        h.gateway.generateObject('minutes.draft', DRAFT, CONTEXT),
      ).resolves.toEqual({ status: 'invalid_output' });
      expect(h.records).toHaveLength(1);
      expect(h.records[0]).toMatchObject({
        outcome: 'invalid_output',
        errorKind: null,
      });
      expect(h.records[0].inputTokens).toBeGreaterThan(0);
    });

    it('answers invalid_output when the adapter could not read the reply as JSON', async () => {
      const h = harness({
        'minutes.draft': () => ({ fail: 'invalid_output' }),
      });
      await expect(
        h.gateway.generateObject('minutes.draft', DRAFT, CONTEXT),
      ).resolves.toEqual({ status: 'invalid_output' });
      expect(h.records[0]).toMatchObject({ outcome: 'invalid_output' });
    });

    it('records what an unreadable reply cost when the adapter says', async () => {
      const billed: ILanguageModel = {
        provider: 'anthropic',
        generate: () =>
          Promise.reject(
            new LanguageModelError('invalid_output', 'anthropic', {
              usage: {
                inputTokens: 900,
                outputTokens: 16_000,
                cachedInputTokens: 0,
              },
            }),
          ),
        // eslint-disable-next-line require-yield
        stream: async function* () {
          await Promise.resolve();
        },
        embed: () => Promise.reject(new Error('unused')),
      };
      const h = harness({}, { model: billed });
      await expect(
        h.gateway.generateObject('minutes.draft', DRAFT, CONTEXT),
      ).resolves.toEqual({ status: 'invalid_output' });
      expect(h.records[0]).toMatchObject({
        outcome: 'invalid_output',
        inputTokens: 900,
        outputTokens: 16_000,
        costMicroUsd: 161_800,
      });
    });

    it('reserves nothing for a schema JSON Schema cannot express', async () => {
      const h = harness({
        'minutes.draft': () => ({ text: '{}', object: {} }),
      });
      await expect(
        h.gateway.generateObject(
          'minutes.draft',
          { ...DRAFT, schema: z.object({ heldOn: z.date() }) },
          CONTEXT,
        ),
      ).rejects.toThrow();
      expect(h.steps).toEqual([]);
    });
  });

  describe('generateCited', () => {
    it('keeps only the quotes that are word for word in the source they name', async () => {
      const grounded = {
        sourceId: 'doc-minutes',
        quote: 'Formal is April 12.',
      };
      const h = harness({
        'ask.answer': () => ({
          text: 'Formal is April 12.',
          citations: [
            grounded,
            // A quote the source does not contain.
            { sourceId: 'doc-minutes', quote: 'Formal is April 19.' },
            // A real quote hung on the wrong document.
            { sourceId: 'doc-bylaws', quote: 'Formal is April 12.' },
            // A document the model was never given.
            { sourceId: 'doc-other-chapter', quote: 'Dues are $450.' },
          ],
        }),
      });

      const result = await h.gateway.generateCited('ask.answer', ASK, CONTEXT);

      expect(result).toMatchObject({
        status: 'ok',
        text: 'Formal is April 12.',
        citations: [grounded],
        droppedCitations: 3,
        truncated: false,
      });
      expect(h.telemetry.callFinished).toHaveBeenCalledWith(expect.anything(), {
        kind: 'cited',
        streamed: false,
        citationsKept: 1,
        citationsDropped: 3,
      });
    });

    it('returns a provider refusal as a result, and records what it cost', async () => {
      const h = harness({
        'ask.answer': () => ({ refuse: { category: 'policy' } }),
      });
      await expect(
        h.gateway.generateCited('ask.answer', ASK, CONTEXT),
      ).resolves.toEqual({ status: 'refused', category: 'policy' });
      expect(h.records[0]).toMatchObject({
        outcome: 'refused',
        outputTokens: 0,
      });
      expect(h.records[0].inputTokens).toBeGreaterThan(0);
    });

    it('throws a provider failure, after settling the reservation', async () => {
      const h = harness({ 'ask.answer': () => ({ fail: 'rate_limited' }) });

      const error = await h.gateway
        .generateCited('ask.answer', ASK, CONTEXT)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LanguageModelError);
      expect(error).toMatchObject({ kind: 'rate_limited', retryable: true });
      expect(h.records).toEqual([
        expect.objectContaining({
          reservationId: 'res-1',
          outcome: 'error',
          errorKind: 'rate_limited',
          inputTokens: 0,
          outputTokens: 0,
          costMicroUsd: 0,
        }),
      ]);
      expect(h.steps).toEqual([
        'consent',
        'reserve',
        'model',
        'record',
        'event',
      ]);
    });

    it('replaces an error that is not the port’s own', async () => {
      const broken: ILanguageModel = {
        provider: 'anthropic',
        generate: () =>
          Promise.reject(new TypeError('prompt was: When is formal?')),
        stream: () => {
          throw new Error('unused');
        },
        embed: () => Promise.reject(new Error('unused')),
      };
      const h = harness({}, { model: broken });

      const error = await h.gateway
        .generateCited('ask.answer', ASK, CONTEXT)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LanguageModelError);
      expect(error).toMatchObject({ kind: 'unknown', provider: 'anthropic' });
      expect((error as Error).message).not.toContain('formal');
      expect(h.records[0]).toMatchObject({
        outcome: 'error',
        errorKind: 'unknown',
      });
    });
  });

  describe('streamCited', () => {
    it('yields the text as it is written, then the checked result, and records once', async () => {
      const h = harness({
        'ask.answer': () => ({
          text: 'Formal is April 12.',
          citations: [
            { sourceId: 'doc-minutes', quote: 'Formal is April 12.' },
            { sourceId: 'doc-minutes', quote: 'made up' },
          ],
        }),
      });

      const events = await collect(
        h.gateway.streamCited('ask.answer', ASK, CONTEXT),
      );

      const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : []));
      expect(text.join('')).toBe('Formal is April 12.');
      expect(events.at(-1)).toEqual({
        type: 'end',
        result: expect.objectContaining({
          status: 'ok',
          citations: [
            { sourceId: 'doc-minutes', quote: 'Formal is April 12.' },
          ],
          droppedCitations: 1,
        }) as unknown,
      });
      expect(h.records).toHaveLength(1);
      expect(h.records[0]).toMatchObject({ outcome: 'completed' });
    });

    it('settles the reservation when the reader leaves before the end', async () => {
      const h = harness({
        'ask.answer': () => ({ text: 'one two three four' }),
      });

      for await (const event of h.gateway.streamCited(
        'ask.answer',
        ASK,
        CONTEXT,
      )) {
        expect(event.type).toBe('text');
        break;
      }

      expect(h.records).toEqual([
        expect.objectContaining({
          reservationId: 'res-1',
          outcome: 'error',
          errorKind: 'aborted',
        }),
      ]);
    });

    it('says so, without the error text, when an abandoned stream cannot be recorded', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const h = harness({
        'ask.answer': () => ({ text: 'one two three four' }),
      });
      h.recorder.record.mockRejectedValue(new Error('row for user-1 failed'));

      for await (const event of h.gateway.streamCited(
        'ask.answer',
        ASK,
        CONTEXT,
      )) {
        expect(event.type).toBe('text');
        break;
      }

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        'AI usage record failed for an abandoned stream (task ask.answer, Error)',
      );
      warn.mockRestore();
    });

    it('marks its event as streamed, so its counts stay off the request span', async () => {
      const h = harness({ 'ask.answer': () => ({ text: 'April 12.' }) });
      await collect(h.gateway.streamCited('ask.answer', ASK, CONTEXT));
      expect(h.telemetry.inSpan).not.toHaveBeenCalled();
      expect(h.telemetry.callFinished).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'cited', streamed: true }),
      );
    });

    it('throws a failure mid-stream, recorded once', async () => {
      const h = harness({ 'ask.answer': () => ({ fail: 'overloaded' }) });
      await expect(
        collect(h.gateway.streamCited('ask.answer', ASK, CONTEXT)),
      ).rejects.toMatchObject({ kind: 'overloaded' });
      expect(h.records).toEqual([
        expect.objectContaining({ outcome: 'error', errorKind: 'overloaded' }),
      ]);
    });

    it('replaces an error that is not the port’s own, mid-stream too', async () => {
      const leaky: ILanguageModel = {
        provider: 'anthropic',
        generate: () => Promise.reject(new Error('unused')),
        // eslint-disable-next-line require-yield
        stream: async function* () {
          await Promise.resolve();
          throw new TypeError('cannot read "When is formal?"');
        },
        embed: () => Promise.reject(new Error('unused')),
      };
      const h = harness({}, { model: leaky });
      const error = await collect(
        h.gateway.streamCited('ask.answer', ASK, CONTEXT),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LanguageModelError);
      expect(error).toMatchObject({ kind: 'unknown' });
      expect((error as Error).message).not.toContain('formal');
      expect(h.records).toEqual([
        expect.objectContaining({ outcome: 'error', errorKind: 'unknown' }),
      ]);
    });

    it('treats a stream that ends without its result as a failure', async () => {
      const silent: ILanguageModel = {
        provider: 'anthropic',
        generate: () => Promise.reject(new Error('unused')),
        // eslint-disable-next-line require-yield
        stream: async function* () {
          await Promise.resolve();
        },
        embed: () => Promise.reject(new Error('unused')),
      };
      const h = harness({}, { model: silent });
      await expect(
        collect(h.gateway.streamCited('ask.answer', ASK, CONTEXT)),
      ).rejects.toMatchObject({ kind: 'unknown' });
      expect(h.records).toHaveLength(1);
    });
  });

  describe('embed', () => {
    it('returns one vector per text at the catalog’s width', async () => {
      const h = harness();
      const result = await h.gateway.embed(
        'corpus.embed',
        { texts: ['bylaws', 'minutes'], promptVersion: 'embed@v1' },
        CONTEXT,
      );

      expect(result).toMatchObject({
        status: 'ok',
        model: 'gemini-embedding-001',
        dimensions: 1536,
      });
      if (result.status !== 'ok') throw new Error('unreachable');
      expect(result.vectors).toHaveLength(2);
      expect(result.vectors[0]).toHaveLength(1536);
      expect(h.spend.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'corpus.embed', family: 'corpus' }),
        { inputTokens: 4, maxOutputTokens: 0, maxCostMicroUsd: 1 },
      );
      expect(h.records[0]).toMatchObject({
        outcome: 'completed',
        inputTokens: 4,
        outputTokens: 0,
      });
      expect(h.telemetry.callFinished).toHaveBeenCalledWith(expect.anything(), {
        kind: 'embedding',
        streamed: false,
        citationsKept: 0,
        citationsDropped: 0,
      });
    });
  });
});

/**
 * #4306: no prompt or answer text in any log line, Sentry event or PostHog
 * event, on a call that succeeds and on one that fails.
 *
 * Everything that could carry text is real here: the installed Sentry SDK
 * with the API's own options (so the gateway's span, and the error the
 * caller's exception filter would report, travel the production scrubbers to
 * a transport that keeps them), `AiTelemetryService`, and Nest's `Logger`.
 * The assertion is on what reached each sink, serialized whole.
 */
describe('AiGatewayService leaves no text behind', () => {
  const PROMPT = 'PROMPT-CANARY brother Smith owes the chapter';
  const SOURCE = 'SOURCE-CANARY standards hearing notes';
  const ANSWER = 'ANSWER-CANARY Smith owes $900';
  const CANARIES = ['PROMPT-CANARY', 'SOURCE-CANARY', 'ANSWER-CANARY'];

  const originalEnabled = process.env.AI_ENABLED;
  const originalSalt = process.env.ANALYTICS_HMAC_SALT;
  let envelopes: unknown[] = [];
  let logged: unknown[] = [];
  let tracked: unknown[] = [];
  let seamInputs: unknown[] = [];

  beforeAll(() => {
    process.env.ANALYTICS_HMAC_SALT = 'ai-gateway-spec-salt';
    Sentry.init({
      ...buildSentryOptions('https://fixturekey@o0.ingest.example.invalid/1'),
      tracesSampleRate: 1,
      // The default set leaks a test environment per worker, and
      // `ContextLines` would attach this file's own source, canaries and all.
      defaultIntegrations: false,
      integrations: [Sentry.linkedErrorsIntegration()],
      transport: () => ({
        send: (envelope: unknown) => {
          envelopes.push(envelope);
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
    envelopes = [];
    logged = [];
    tracked = [];
    seamInputs = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => void logged.push(args));
      jest
        .spyOn(Logger, level)
        .mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn(console, level)
        .mockImplementation((...args: unknown[]) => void logged.push(args));
    }
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await Sentry.close(2000);
    if (originalEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = originalEnabled;
    if (originalSalt === undefined) delete process.env.ANALYTICS_HMAC_SALT;
    else process.env.ANALYTICS_HMAC_SALT = originalSalt;
  });

  function realGateway(model: ILanguageModel): AiGatewayService {
    const analytics = {
      track: (
        name: string,
        userId: string,
        options: { properties?: object },
      ) => {
        // What `AnalyticsService.track` runs before anything else.
        assertContentFreeProperties({
          name,
          properties: options.properties as never,
        });
        tracked.push({ name, userId, options });
        return Promise.resolve();
      },
    } as unknown as AnalyticsService;
    const keep =
      <T>(result: T) =>
      (...args: unknown[]): Promise<T> => {
        seamInputs.push(args);
        return Promise.resolve(result);
      };

    return new AiGatewayService(
      { resolve: () => model },
      { check: keep({ allowed: true as const }) },
      { reserve: keep({ granted: true as const, reservationId: 'res-1' }) },
      { record: keep(undefined) },
      new AiTelemetryService(analytics),
    );
  }

  const prompt = {
    promptVersion: 'ask@v1',
    system: PROMPT,
    messages: [{ role: 'user' as const, content: PROMPT }],
    sources: [{ id: 'doc-1', title: 'Hearing', text: SOURCE }],
  };

  async function everythingThatLeft(): Promise<string> {
    await Sentry.flush(2000);
    return JSON.stringify({ envelopes, logged, tracked, seamInputs });
  }

  it('on a call that succeeds', async () => {
    const gateway = realGateway(
      new ScriptedLanguageModel({
        'ask.answer': () => ({
          text: ANSWER,
          citations: [{ sourceId: 'doc-1', quote: SOURCE }],
        }),
      }),
    );

    const result = await Sentry.startSpan({ name: 'POST /v1/ask' }, () =>
      gateway.generateCited('ask.answer', prompt, CONTEXT),
    );
    expect(result).toMatchObject({ status: 'ok', text: ANSWER });

    const left = await everythingThatLeft();
    // The sinks were really reached: an event, and a transaction whose
    // gateway span kept its allowlisted keys.
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({ name: AI_CALL_EVENT });
    expect(left).toContain('ai.gateway.call');
    expect(left).toContain('"ai.task":"ask.answer"');
    expect(left).toContain('"ai.outcome":"completed"');
    for (const canary of CANARIES) expect(left).not.toContain(canary);
  });

  it('on a call that fails', async () => {
    // The worst case: an adapter bug throws an error that quotes the request.
    const leaky: ILanguageModel = {
      provider: 'anthropic',
      generate: (request) =>
        Promise.reject(
          new Error(`400 ${JSON.stringify(request)} partial answer ${ANSWER}`),
        ),
      stream: () => {
        throw new Error('unused');
      },
      embed: () => Promise.reject(new Error('unused')),
    };
    const gateway = realGateway(leaky);

    const error = await Sentry.startSpan({ name: 'POST /v1/ask' }, () =>
      gateway.generateCited('ask.answer', prompt, CONTEXT),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LanguageModelError);
    // What the API's exception filter does with an error it did not expect.
    Sentry.captureException(error);
    new Logger('AllExceptionsFilter').error(error);

    const left = await everythingThatLeft();
    expect(tracked[0]).toMatchObject({
      options: { properties: { outcome: 'error', error_kind: 'unknown' } },
    });
    expect(left).toContain('AI provider call failed: unknown');
    expect(left).toContain('"ai.outcome":"error"');
    for (const canary of CANARIES) expect(left).not.toContain(canary);
  });
});
