/**
 * Proof of the default (#4315, `spec/behavior/ai.md` § Stored AI text):
 * an AI call with no report made leaves its text nowhere. Not in a database
 * write, not in a log line, not in a Sentry event or span, not in a PostHog
 * event.
 *
 * It runs Ask, the AI feature that reads the most (a question, chapter
 * passages, a member's chat, live data, and the model's answer), through the
 * product's own gateway, spend ledger, telemetry and diagnostics window, with
 * the scripted adapter standing in for a model. Every piece of text that
 * enters or leaves the model carries a canary. Then it searches everything
 * those layers wrote for any canary:
 *
 * - **Database:** every call that reaches the Supabase client (the spend
 *   ledger's holds and settlements, the diagnostics window's reads), through
 *   a client that records each argument. The diagnostics window is the one
 *   built-in place Ask can store text; it is left off here, as it is for
 *   every chapter but one, and the server holds a sealing key, so a report
 *   could be made and none is.
 * - **Logs:** everything written to stdout and stderr, and every console
 *   call, which is where Nest's logger and `reportCaughtFailure` write.
 * - **Sentry:** every call into `@sentry/nestjs` (exceptions, messages,
 *   spans and their attributes).
 * - **PostHog:** every event the AI telemetry tracks.
 *
 * It runs three ways: an answer, a provider failure part-way through the
 * stream (the controller's failure path, which reports to Sentry), and a
 * provider whose error message repeats the prompt, which the gateway must
 * not let through.
 *
 * What it does not cover: the minutes draft stores its notes and output
 * beside the unposted minutes on purpose (`meetings.md` § Drafting from
 * notes), and a suggestion holds its proposal while it waits (`ai.md` §
 * Suggestions); both are rows the spec allows, and their own specs prove
 * when they are emptied. The answer the member receives carries a sealed
 * report receipt; it is checked here to hold no readable text.
 */
import { Writable } from 'node:stream';
import type { Response } from 'express';
import type {
  ILanguageModel,
  ILanguageModelRegistry,
  LanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import { ScriptedLanguageModel } from '../../infrastructure/ai/scripted-language-model';
import { SupabaseAiUsageRepository } from '../../infrastructure/supabase/repositories/supabase-ai-usage.repository';
import { SupabaseAskDiagnosticsRepository } from '../../infrastructure/supabase/repositories/supabase-ask-diagnostics.repository';
import { AskController } from './ask.controller';
import type { CorpusPassage } from '../../application/services/corpus/corpus-retrieval.service';
import { AskDiagnosticsService } from '../../application/services/ask/ask-diagnostics.service';
import type { AskTool } from '../../application/services/ask/ask-tool';
import { AskConversationService } from '../../application/services/ask/ask-conversation.service';
import { AskService } from '../../application/services/ask/ask.service';
import { AiGatewayService } from '../../application/services/ai/ai-gateway.service';
import { AiSpendLedgerService } from '../../application/services/ai/ai-spend-ledger.service';
import { AiTelemetryService } from '../../application/services/ai/ai-telemetry.service';

const sentryCalls: unknown[][] = [];
jest.mock('@sentry/nestjs', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      sentryCalls.push([name, ...args]);
      return undefined;
    };
  const span = {
    setAttributes: (attributes: unknown) =>
      sentryCalls.push(['span.setAttributes', attributes]),
    setAttribute: (...args: unknown[]) =>
      sentryCalls.push(['span.setAttribute', ...args]),
    setStatus: (...args: unknown[]) =>
      sentryCalls.push(['span.setStatus', ...args]),
    end: () => undefined,
  };
  const scope = new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        (...args: unknown[]) => {
          sentryCalls.push([`scope.${name}`, ...args]);
          return scope;
        },
    },
  );
  return new Proxy(
    {
      startSpan: (options: unknown, run: (span: unknown) => unknown) => {
        sentryCalls.push(['startSpan', options]);
        return run(span);
      },
      getActiveSpan: () => span,
      withScope: (run: (scope: unknown) => unknown) => run(scope),
      withIsolationScope: (run: (scope: unknown) => unknown) => run(scope),
      getIsolationScope: () => scope,
      getCurrentScope: () => scope,
    },
    {
      get: (target, name: string) =>
        (target as Record<string, unknown>)[name] ?? record(name),
    },
  );
});

const CHAPTER = '0a000000-0000-4000-8000-000000004315';
const USER = '0b000000-0000-4000-8000-000000004315';
const NOW = new Date('2026-11-12T18:00:00.000Z');

/** Text that goes into and comes out of the model, each marked. */
const CANARY = {
  question: 'canaryq4315',
  document: 'canarydoc4315',
  chat: 'canarychat4315',
  tool: 'canarytool4315',
  answer: 'canaryans4315',
  asker: 'canaryasker4890',
} as const;
const CANARIES = Object.values(CANARY);

const QUESTION = `When is the ${CANARY.question} formal?`;
const DOCUMENT_TEXT = `The ${CANARY.document} formal is on March 3.`;

function passage(over: Partial<CorpusPassage>): CorpusPassage {
  return {
    id: 'p-doc',
    sourceType: 'chapter_document',
    sourceId: 'doc-1',
    title: 'Social calendar',
    heading: null,
    text: DOCUMENT_TEXT,
    pageStart: 1,
    pageEnd: 1,
    sourceAt: '2026-10-01T00:00:00.000Z',
    score: 1,
    matchedBy: ['semantic'],
    channelId: null,
    messageId: null,
    authorIds: [],
    messageCount: null,
    ...over,
  };
}

/** Everything any layer under test handed to the outside. */
interface Captured {
  database: unknown[][];
  output: string[];
  sentry: unknown[][];
  analytics: unknown[][];
}

/**
 * A Supabase client that answers every query with "nothing" and records
 * every argument it was given, on any table or RPC.
 */
function recordingSupabase(database: unknown[][]) {
  const rpcAnswers: Record<string, unknown> = {
    reserve_ai_spend: [
      {
        reservation_id: '0c000000-0000-4000-8000-000000000001',
        refused: null,
        platform_spent_before: 0,
        platform_spent_after: 1,
      },
    ],
    settle_ai_spend: 'settled',
  };
  const builder = (path: string): unknown => {
    const result = { data: null, error: null };
    const target = Object.assign(() => undefined, {
      then: (resolve: (value: unknown) => unknown) => resolve(result),
    });
    return new Proxy(target, {
      get: (_target, name: string) => {
        if (name === 'then') return target.then;
        return (...args: unknown[]) => {
          database.push([`${path}.${name}`, ...args]);
          return builder(`${path}.${name}`);
        };
      },
    });
  };
  return {
    from: (table: string) => {
      database.push(['from', table]);
      return builder(table);
    },
    rpc: (fn: string, args: unknown) => {
      database.push(['rpc', fn, args]);
      return Promise.resolve({ data: rpcAnswers[fn] ?? null, error: null });
    },
  };
}

function captureOutput(output: string[]): () => void {
  const restore: Array<() => void> = [];
  for (const stream of [process.stdout, process.stderr] as Writable[]) {
    const original = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      output.push(String(chunk));
      return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    restore.push(() => {
      stream.write = original;
    });
  }
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const spy = jest
      .spyOn(console, level)
      .mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      });
    restore.push(() => spy.mockRestore());
  }
  return () => restore.forEach((undo) => undo());
}

/** The scripted model: it reads the sources and repeats them in its answer. */
function scriptedModel(): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    'ask.plan': () => ({
      text: JSON.stringify({ tools: ['roster'] }),
      object: { tools: ['roster'] },
    }),
    'ask.answer': (request: LanguageModelRequest) => {
      const sources = request.kind === 'cited' ? request.sources : [];
      const doc = sources.find((source) => source.text === DOCUMENT_TEXT);
      return {
        text: `The ${CANARY.answer} formal is on March 3. ${sources
          .map((source) => source.text)
          .join(' ')}`,
        citations: doc ? [{ sourceId: doc.id, quote: DOCUMENT_TEXT }] : [],
      };
    },
  });
}

/** A provider whose own error message repeats the prompt. */
function echoingModel(): ILanguageModel {
  const scripted = scriptedModel();
  return {
    provider: scripted.provider,
    generate: (request) => scripted.generate(request),
    // eslint-disable-next-line require-yield
    async *stream(request) {
      throw new Error(
        `upstream rejected: ${request.messages.map((m) => m.content).join(' ')}`,
      );
    },
    embed: (request) => scripted.embed(request),
  };
}

function build(model: ILanguageModel, captured: Captured) {
  const supabase = recordingSupabase(captured.database);
  const registry: ILanguageModelRegistry = { resolve: () => model };
  const ledger = new AiSpendLedgerService(
    new SupabaseAiUsageRepository(supabase as never),
  );
  const telemetry = new AiTelemetryService({
    track: (...args: unknown[]) => {
      captured.analytics.push(args);
      return Promise.resolve();
    },
  } as never);
  const consent = {
    check: () => Promise.resolve({ allowed: true }),
    chatAuthorsWhoSaidYes: (_chapter: string, authors: readonly string[]) =>
      Promise.resolve(new Set(authors)),
    onConsentWithdrawn: () => undefined,
    getConsentState: () => Promise.resolve({ answer: 'yes' }),
  };
  const gateway = new AiGatewayService(
    registry,
    consent as never,
    ledger,
    ledger,
    telemetry,
  );
  const diagnostics = new AskDiagnosticsService(
    new SupabaseAskDiagnosticsRepository(supabase as never),
    { findByChapterAndSystemKey: () => Promise.resolve(null) } as never,
    { findByUserAndChapter: () => Promise.resolve(null) } as never,
    consent as never,
    { record: () => Promise.resolve() } as never,
  );
  const roster: AskTool = {
    name: 'roster',
    description: 'Who is in the chapter.',
    kind: 'roster',
    title: 'Roster',
    page: 'members',
    reach: 'chapter',
    permission: SystemPermissions.MEMBERS_VIEW,
    module: null,
    effect: 'read',
    run: () =>
      Promise.resolve({
        chapterId: CHAPTER,
        text: `Social chair: ${CANARY.tool}`,
      }),
  };
  const retrieval = {
    retrieve: () =>
      Promise.resolve({
        status: 'ok',
        leftOutMessages: 0,
        passages: [
          passage({}),
          passage({
            id: 'p-chat',
            sourceType: 'chat_message',
            sourceId: 'window-1',
            title: 'general',
            text: `Dana: the ${CANARY.chat} bus leaves at 6.`,
            channelId: 'channel-1',
            messageId: 'message-1',
            authorIds: ['dana'],
            messageCount: 1,
          }),
        ],
      }),
  };
  const ask = new AskService(
    retrieval as never,
    gateway,
    consent as never,
    {
      getEffectivePermissions: () =>
        Promise.resolve([SystemPermissions.MEMBERS_VIEW]),
      // Who is asking reaches the model too (#4890), under its own canary.
      findByChapter: () =>
        Promise.resolve([
          { id: 'role-1', name: `${CANARY.asker} chair`, system_key: null },
        ]),
    } as never,
    {
      findByUserAndChapter: () => Promise.resolve({ role_ids: ['role-1'] }),
    } as never,
    {
      findDisplayIdentitiesByIds: () =>
        Promise.resolve([{ id: USER, display_name: `Sam ${CANARY.asker}` }]),
    } as never,
    diagnostics,
    [roster],
  );
  return new AskController(
    ask,
    // The request lane is never reached: these asks do not send `actions`.
    new AskConversationService(ask, {} as never),
    diagnostics,
    // The opening suggestions call no model and store nothing.
    {} as never,
    // The door count is one more thing sent to PostHog, so it is read for
    // leaks with the rest.
    {
      track: (...args: unknown[]) => {
        captured.analytics.push(args);
        return Promise.resolve();
      },
    } as never,
  );
}

/** The response the controller streams to, keeping what the member gets. */
function fakeResponse(): { response: Response; body: string[] } {
  const body: string[] = [];
  const response = {
    destroyed: false,
    on: () => response,
    status: () => response,
    set: () => response,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      body.push(chunk);
      return true;
    },
    end: () => undefined,
  };
  return { response: response as unknown as Response, body };
}

/** Each canary found in `values`, by where it was found. */
function leaks(captured: Captured): string[] {
  const found: string[] = [];
  const sinks: Record<string, unknown> = {
    database: captured.database,
    logs: captured.output,
    sentry: captured.sentry,
    posthog: captured.analytics,
  };
  for (const [sink, value] of Object.entries(sinks)) {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[seen]';
        seen.add(item);
      }
      return item;
    });
    for (const canary of CANARIES) {
      if (text?.includes(canary)) found.push(`${canary} in ${sink}`);
    }
  }
  return found;
}

async function askThrough(model: ILanguageModel) {
  const captured: Captured = {
    database: [],
    output: [],
    sentry: sentryCalls,
    analytics: [],
  };
  sentryCalls.length = 0;
  const controller = build(model, captured);
  const { response, body } = fakeResponse();
  const restore = captureOutput(captured.output);
  try {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    await controller.ask(
      CHAPTER,
      USER,
      null,
      'America/New_York',
      { question: QUESTION },
      response,
      { headers: {} },
    );
  } finally {
    jest.useRealTimers();
    restore();
  }
  return { captured, body: body.join('') };
}

describe('Stored AI text: an AI call with no report made keeps no text (#4315)', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    // A sealing key is set, so the only thing between this call and stored
    // text is that nobody reported it and no diagnostics window is open.
    process.env.AI_STORED_TEXT_KEY = `k1:${Buffer.alloc(32, 3).toString('base64')}`;
    delete process.env.AI_DIAGNOSTICS_CHAPTER_ID;
    process.env.AI_ENABLED = 'true';
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('an answer leaves no text in the database, the logs, Sentry or PostHog', async () => {
    const { captured, body } = await askThrough(scriptedModel());

    // The call really ran and the text really flowed: the member got an
    // answer quoting the sources, and the gateway wrote its ledger rows and
    // its telemetry.
    expect(body).toContain(CANARY.answer);
    expect(body).toContain(CANARY.document);
    expect(
      captured.database.some((call) => call[1] === 'reserve_ai_spend'),
    ).toBe(true);
    expect(
      captured.database.some((call) => call[1] === 'settle_ai_spend'),
    ).toBe(true);
    expect(captured.analytics.length).toBeGreaterThan(0);
    expect(captured.sentry.some((call) => call[0] === 'startSpan')).toBe(true);

    expect(leaks(captured)).toEqual([]);
  });

  it('the report receipt in the answer holds no readable text', async () => {
    const { body } = await askThrough(scriptedModel());
    const done = body
      .split('\n\n')
      .map((frame) => frame.replace(/^data: /, ''))
      .filter((frame) => frame.startsWith('{'))
      .map((frame) => JSON.parse(frame) as { type: string; answer?: unknown })
      .find((event) => event.type === 'done');
    const receipt = (done?.answer as { report_receipt?: string } | undefined)
      ?.report_receipt;
    expect(receipt).toEqual(expect.stringMatching(/^v1\./));
    for (const canary of CANARIES) expect(receipt).not.toContain(canary);
  });

  it('a provider failure part-way through is reported without the text', async () => {
    const failing = scriptedModel();
    const model: ILanguageModel = {
      provider: failing.provider,
      generate: (request) => failing.generate(request),
      async *stream(request) {
        for await (const part of failing.stream(request)) {
          if (part.type === 'text') {
            yield part;
            const { LanguageModelError } =
              await import('#domain/adapters/language-model.interface');
            throw new LanguageModelError('unknown', failing.provider);
          }
        }
      },
      embed: (request) => failing.embed(request),
    };
    const { captured, body } = await askThrough(model);
    expect(body).toContain('"type":"error"');
    // The failure was reported (the controller's failure path ran) ...
    expect(
      captured.sentry.some((call) =>
        ['captureException', 'captureMessage'].includes(String(call[0])),
      ) || captured.output.some((line) => line.includes('ask-stream')),
    ).toBe(true);
    // ... and carries none of the text.
    expect(leaks(captured)).toEqual([]);
  });

  it('a provider whose error repeats the prompt does not get it into a report', async () => {
    const { captured, body } = await askThrough(echoingModel());
    expect(body).toContain('"type":"error"');
    expect(leaks(captured)).toEqual([]);
  });
});
