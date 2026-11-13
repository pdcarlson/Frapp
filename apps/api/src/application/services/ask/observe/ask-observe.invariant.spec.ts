/**
 * Proof that the trace and the thumbs keep no text (#4902,
 * `spec/behavior/ai.md` § Stored AI text), beside
 * `ai-stored-text.invariant.spec.ts`, which proves it for the ask itself.
 *
 * A trace has no field for a question or an answer, so the only way text
 * could get in is through a field meant for a code: a door, a model name, a
 * tool's name, an outcome, an error kind. This hands the recorder a turn
 * with a canary in every one of those (a bare word where the field is
 * checked against a list, a sentence where it is checked by shape, which is
 * the limit `ask-trace.ts` states), through the real services and the
 * real repository, and then searches everything they handed to the outside
 * (every database call, every log line, every Sentry call, every analytics
 * event) for any canary. It does the same for a thumbs, a signal, and a
 * write the database refuses.
 */
import { Writable } from 'node:stream';
import { SupabaseAskTraceRepository } from '../../../../infrastructure/supabase/repositories/supabase-ask-trace.repository';
import { AskFeedbackService } from './ask-feedback.service';
import { ASK, CHAPTER, USER, model, tool, turn } from './ask-trace.fixture';
import { AskTraceService } from './ask-trace.service';

const sentryCalls: unknown[][] = [];
jest.mock('@sentry/nestjs', () => {
  const scope: unknown = new Proxy(
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
      withScope: (run: (scope: unknown) => unknown) => run(scope),
      withIsolationScope: (run: (scope: unknown) => unknown) => run(scope),
      getIsolationScope: () => scope,
      getCurrentScope: () => scope,
    },
    {
      get: (target, name: string) =>
        (target as Record<string, unknown>)[name] ??
        ((...args: unknown[]) => {
          sentryCalls.push([name, ...args]);
          return undefined;
        }),
    },
  );
});

/** Text of the kinds a turn handles, each marked. */
const CANARY = {
  question: 'canaryq4902',
  answer: 'canaryans4902',
  args: 'canaryargs4902',
  result: 'canaryres4902',
  error: 'canaryerr4902',
} as const;
const CANARIES = Object.values(CANARY);

interface Captured {
  database: unknown[][];
  output: string[];
  analytics: unknown[][];
}

/**
 * A Supabase client that records every argument it is given. Reads answer
 * with the asker's own trace, so a thumbs has something to stand on.
 */
function recordingSupabase(database: unknown[][], failInsertsWith?: string) {
  const rows: Record<string, unknown> = {
    ai_ask_traces: {
      id: ASK,
      door: 'ask',
      prompt_version: 'ask.answer@v4',
      model: 'model',
      effort: 'default',
      outcome: 'answered',
    },
    ai_ask_feedback: {
      ask_id: ASK,
      chapter_id: CHAPTER,
      user_id: USER,
      rating: 'down',
      reason: 'wrong',
      created_at: '2026-11-13T20:05:00.000Z',
      updated_at: '2026-11-13T20:05:00.000Z',
    },
  };
  const builder = (table: string, path: string): unknown => {
    const row = rows[table] ?? null;
    // Only a write fails, so the reads before it pass and the turn's row
    // really is handed to the database before it says no.
    const result =
      failInsertsWith && path.includes('.insert')
        ? { data: null, error: { code: 'XX000', message: failInsertsWith } }
        : // A delete answers with the rows it removed.
          { data: path.includes('.delete') ? [row] : row, error: null };
    const target = Object.assign(() => undefined, {
      then: (resolve: (value: unknown) => unknown) => resolve(result),
    });
    return new Proxy(target, {
      get: (_target, name: string) => {
        if (name === 'then') return target.then;
        return (...args: unknown[]) => {
          database.push([`${path}.${name}`, ...args]);
          return builder(table, `${path}.${name}`);
        };
      },
    });
  };
  return {
    from: (table: string) => {
      database.push(['from', table]);
      return builder(table, table);
    },
  };
}

function captureOutput(output: string[]): () => void {
  const restore: Array<() => void> = [];
  for (const stream of [process.stdout, process.stderr] as Writable[]) {
    const original = stream.write.bind(stream);
    stream.write = ((chunk: unknown) => {
      output.push(String(chunk));
      return true;
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

function build(captured: Captured, failWith?: string) {
  const repository = new SupabaseAskTraceRepository(
    recordingSupabase(captured.database, failWith) as never,
  );
  const analytics = {
    track: (...args: unknown[]) => {
      captured.analytics.push(args);
      return Promise.resolve();
    },
  };
  const traces = new AskTraceService(
    repository,
    {
      findByUserAndChapter: () => Promise.resolve({ id: 'member-1' }),
    } as never,
    {
      onConsentWithdrawn: () => undefined,
      getConsentState: () => Promise.resolve({ answer: 'yes' }),
    } as never,
    analytics as never,
  );
  const feedback = new AskFeedbackService(repository, analytics as never);
  return { traces, feedback };
}

function leaks(captured: Captured): string[] {
  const found: string[] = [];
  const sinks: Record<string, unknown> = {
    database: captured.database,
    logs: captured.output,
    sentry: sentryCalls,
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

/** A turn whose every string field holds what it must never hold. */
function leakyTurn() {
  return turn({
    // A bare word where the field is checked against a list ...
    door: CANARY.question,
    effort: CANARY.question,
    // ... and a sentence where it is checked by shape.
    promptVersion: `When is the ${CANARY.question} formal?`,
    model: `The ${CANARY.answer} formal is on March 3.`,
    outcome: 'error',
    errorKind: `upstream rejected: ${CANARY.error}`,
    steps: [
      model({ outcome: CANARY.answer as never }),
      tool({ tool: `{"query":"${CANARY.args}"}` }),
      tool({ tool: CANARY.args }),
      tool({ tool: CANARY.args, outcome: 'unknown_tool' }),
      tool({ outcome: `Dana: the ${CANARY.result} bus leaves at 6.` as never }),
      // A field the type does not have, as a careless caller could add.
      { ...tool(), args: CANARY.args, result: CANARY.result } as never,
    ],
    ...({ question: CANARY.question, answer: CANARY.answer } as object),
  });
}

async function run(
  work: (built: ReturnType<typeof build>) => Promise<unknown>,
  failWith?: string,
): Promise<Captured> {
  const captured: Captured = { database: [], output: [], analytics: [] };
  sentryCalls.length = 0;
  const built = build(captured, failWith);
  const restore = captureOutput(captured.output);
  try {
    await work(built);
  } finally {
    restore();
  }
  return captured;
}

describe('Stored AI text: a trace and a thumbs keep no text (#4902)', () => {
  it('a turn with text in every code field leaves none in the database, the logs, Sentry or PostHog', async () => {
    const captured = await run(({ traces }) => traces.record(leakyTurn()));

    // The write really happened: the trace, its steps and its events.
    const tables = captured.database
      .filter((call) => call[0] === 'from')
      .map((call) => call[1]);
    expect(tables).toEqual(
      expect.arrayContaining(['ai_ask_traces', 'ai_ask_trace_steps']),
    );
    expect(
      captured.database.some((call) => call[0] === 'ai_ask_traces.insert'),
    ).toBe(true);
    expect(captured.analytics.length).toBeGreaterThan(1);

    expect(leaks(captured)).toEqual([]);
  });

  it('a write the database refuses is reported without the turn', async () => {
    const captured = await run(
      ({ traces }) => traces.record(leakyTurn()),
      'insert failed',
    );
    expect(
      captured.database.some((call) => call[0] === 'ai_ask_traces.insert'),
    ).toBe(true);
    // The failure was reported ...
    expect(
      captured.output.some((line) => line.includes('Ask trace')) ||
        sentryCalls.length > 0,
    ).toBe(true);
    // ... and carries none of it.
    expect(leaks(captured)).toEqual([]);
    expect(captured.analytics).toEqual([]);
  });

  it('a thumbs and a signal write and send only codes', async () => {
    const actor = { chapterId: CHAPTER, userId: USER, askId: ASK };
    const captured = await run(async ({ feedback }) => {
      await feedback.rate(actor, 'down', 'missed');
      await feedback.signal(actor, 'source_opened');
      await feedback.clear(actor);
    });
    const upsert = captured.database.find(
      (call) => call[0] === 'ai_ask_feedback.upsert',
    );
    // Everything a thumbs writes, by name: no column for anything else.
    expect(Object.keys(upsert?.[1] as object).sort()).toEqual([
      'ask_id',
      'chapter_id',
      'rating',
      'reason',
      'updated_at',
      'user_id',
    ]);
    expect(captured.analytics).toHaveLength(3);
    expect(leaks(captured)).toEqual([]);
  });
});
