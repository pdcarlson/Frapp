import { z } from 'zod';
import type { LanguageModelToolCall } from '#domain/adapters/language-model.interface';
import type {
  AiAgentPrompt,
  AiAgentRoundResult,
  AiAgentStreamEvent,
} from '../../ai/ai-gateway.service';
import {
  AGENT_MAX_CALLS,
  AGENT_LIMITS,
  AGENT_MAX_ROUNDS,
  AGENT_READ_BUDGET_MS,
  AgentLoopService,
  type AgentLoopEvent,
  type AgentLoopInput,
  type AgentLoopOutcome,
} from './agent-loop.service';
import {
  AGENT_RESULT_MAX_CHARS,
  AGENT_RESULT_MAX_SOURCES,
  AgentToolUnavailableError,
  type AgentCard,
  type AgentProposeResult,
  type AgentProposeTool,
  type AgentReadTool,
  type AgentSource,
  type AgentToolResult,
} from './agent-tool';

jest.mock(
  '../../../../infrastructure/observability/report-caught-failure',
  () => ({ reportCaughtFailure: jest.fn() }),
);

const CHAPTER = 'chapter-1';
const USER = 'user-1';

const source = (over: Partial<AgentSource> = {}): AgentSource => ({
  id: 'message:m1',
  kind: 'chat',
  title: '#general',
  detail: 'Sam Park',
  date: '2026-11-10T15:00:00.000Z',
  target: { type: 'message', channel_id: 'c1', message_id: 'm1' },
  text: 'Sam Park: dues are $450',
  chat: true,
  authorIds: ['sam'],
  ...over,
});

const found = (over: Partial<AgentToolResult> = {}): AgentToolResult => ({
  chapterId: CHAPTER,
  sources: [source()],
  entities: [{ type: 'member', id: 'sam', name: 'Sam Park' }],
  note: null,
  leftOutMessages: 0,
  ...over,
});

function tool(
  name: string,
  run: AgentReadTool<{ query: string }>['run'] = () => Promise.resolve(found()),
): AgentReadTool<{ query: string }> & { run: jest.Mock } {
  return {
    name,
    description: `Reads ${name}.`,
    permission: 'members:view',
    module: null,
    effect: 'read',
    input: z.object({ query: z.string().describe('What to look for.') }),
    reading: `Reading ${name}`,
    run: jest.fn(run),
  };
}

const call = (
  name: string,
  input: unknown = { query: 'dues' },
  id = `call-${name}`,
): LanguageModelToolCall => ({ id, name, input });

const round = (
  over: Partial<Extract<AiAgentRoundResult, { status: 'ok' }>> = {},
): AiAgentRoundResult => ({
  status: 'ok',
  text: '',
  citations: [],
  droppedCitations: 0,
  toolCalls: [],
  replay: { n: Math.random() },
  truncated: false,
  usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 },
  ...over,
});

/** A gateway whose rounds are scripted, in order; the last one repeats. */
function build(
  script: (AiAgentRoundResult | { text: string[]; then: AiAgentRoundResult })[],
) {
  const prompts: AiAgentPrompt[] = [];
  const gateway = {
    streamAgentRound: jest.fn(async function* (
      _task: string,
      prompt: AiAgentPrompt,
    ): AsyncGenerator<AiAgentStreamEvent> {
      // The loop reuses the array, so a round is kept as it was sent.
      prompts.push({ ...prompt, rounds: [...prompt.rounds] });
      const next = script[Math.min(prompts.length - 1, script.length - 1)];
      await Promise.resolve();
      if ('then' in next) {
        for (const delta of next.text) yield { type: 'text', delta };
        yield { type: 'end', result: next.then };
      } else yield { type: 'end', result: next };
    }),
  };
  return { loop: new AgentLoopService(gateway as never), gateway, prompts };
}

function input(over: Partial<AgentLoopInput> = {}): AgentLoopInput {
  return {
    task: 'ask.agent',
    promptVersion: 'ask.agent@v1',
    system: 'You are Ask Frapp.',
    messages: [{ role: 'user', content: 'What do I owe?' }],
    context: [],
    tools: [tool('search_messages')],
    toolContext: {
      chapterId: CHAPTER,
      userId: USER,
      now: new Date('2026-11-13T12:00:00.000Z'),
      timeZone: 'America/New_York',
      permissions: new Set(['members:view']),
      enabledModules: null,
    },
    call: { chapterId: CHAPTER, actingUserId: USER },
    titleOf: (found) => `Chat message in ${found.title}`,
    ...over,
  };
}

async function run(loop: AgentLoopService, given: AgentLoopInput) {
  const events: AgentLoopEvent[] = [];
  for await (const event of loop.run(given)) events.push(event);
  const end = events.find((event) => event.type === 'end');
  return {
    events,
    outcome: (end as { outcome: AgentLoopOutcome } | undefined)?.outcome,
  };
}

describe('AgentLoopService', () => {
  it('runs what the model asks for, hands the result back as sources, and ends on the answer', async () => {
    const search = tool('search_messages');
    const answer = round({
      text: 'You owe $450.',
      citations: [{ sourceId: 'message:m1', quote: 'dues are $450' }],
    });
    const { loop, prompts } = build([
      round({ toolCalls: [call('search_messages')], replay: 'turn-1' }),
      answer,
    ]);

    const { events, outcome } = await run(loop, input({ tools: [search] }));

    expect(search.run).toHaveBeenCalledWith(
      { query: 'dues' },
      expect.objectContaining({ chapterId: CHAPTER, userId: USER }),
    );
    // The tool's schema is what the model was shown.
    expect(prompts[0].tools).toEqual([
      {
        name: 'search_messages',
        description: 'Reads search_messages.',
        inputSchema: expect.objectContaining({
          type: 'object',
          required: ['query'],
        }) as unknown,
      },
    ]);
    expect(prompts[0].rounds).toEqual([]);
    expect(prompts[1].rounds).toEqual([
      {
        replay: 'turn-1',
        results: [
          {
            callId: 'call-search_messages',
            sources: [
              {
                id: 'message:m1',
                title: 'Chat message in #general',
                text: 'Sam Park: dues are $450',
              },
            ],
            note: null,
          },
        ],
      },
    ]);
    expect(events.map((event) => event.type)).toEqual(['tool', 'end']);
    expect(events[0]).toEqual({
      type: 'tool',
      name: 'search_messages',
      reading: 'Reading search_messages',
      effect: 'read',
    });
    expect(outcome).toMatchObject({
      stop: 'answered',
      result: { status: 'ok', text: 'You owe $450.' },
      sources: [{ id: 'message:m1' }],
      entities: [{ type: 'member', id: 'sam', name: 'Sam Park' }],
      rounds: [
        { calls: [{ tool: 'search_messages', outcome: 'ok', sources: 1 }] },
        { calls: [] },
      ],
    });
  });

  it('forwards words as they are written, and says so when they were not the answer', async () => {
    const { loop } = build([
      {
        text: ['Let me ', 'look.'],
        then: round({ toolCalls: [call('search_messages')] }),
      },
      { text: ['You owe ', '$450.'], then: round({ text: 'You owe $450.' }) },
    ]);

    const { events } = await run(loop, input());

    expect(events.map((event) => event.type)).toEqual([
      'text',
      'text',
      'discard',
      'tool',
      'text',
      'text',
      'end',
    ]);
  });

  describe('what it refuses to run', () => {
    it('a tool that was not offered, whatever it is called', async () => {
      const search = tool('search_messages');
      const { loop, prompts } = build([
        round({ toolCalls: [call('give_points'), call('chapter_tasks')] }),
        round({ text: 'done' }),
      ]);

      const { events, outcome } = await run(loop, input({ tools: [search] }));

      expect(search.run).not.toHaveBeenCalled();
      expect(events.some((event) => event.type === 'tool')).toBe(false);
      expect(prompts[1].rounds[0].results).toEqual([
        {
          callId: 'call-give_points',
          sources: [],
          note: 'That tool is not available.',
          failed: true,
        },
        {
          callId: 'call-chapter_tasks',
          sources: [],
          note: 'That tool is not available.',
          failed: true,
        },
      ]);
      // The trace never repeats a name the model made up.
      expect(outcome?.rounds[0].calls).toEqual([
        expect.objectContaining({
          tool: '(not offered)',
          outcome: 'unknown_tool',
        }),
        expect.objectContaining({
          tool: '(not offered)',
          outcome: 'unknown_tool',
        }),
      ]);
    });

    it('arguments that fail the tool’s schema, without repeating them', async () => {
      const search = tool('search_messages');
      const { loop, prompts } = build([
        round({
          toolCalls: [
            call('search_messages', { query: 7, chapter_id: 'other-chapter' }),
          ],
        }),
        round({ text: 'done' }),
      ]);

      const { outcome } = await run(loop, input({ tools: [search] }));

      expect(search.run).not.toHaveBeenCalled();
      const [result] = prompts[1].rounds[0].results;
      expect(result).toMatchObject({ failed: true, sources: [] });
      expect(result.note).toContain('query');
      expect(result.note).not.toContain('other-chapter');
      expect(outcome?.rounds[0].calls[0]).toMatchObject({
        tool: 'search_messages',
        outcome: 'bad_arguments',
      });
    });

    it('a result read from another chapter', async () => {
      const leaky = tool('search_messages', () =>
        Promise.resolve(found({ chapterId: 'chapter-2' })),
      );
      const { loop, prompts } = build([
        round({ toolCalls: [call('search_messages')] }),
        round({ text: 'done' }),
      ]);

      const { outcome } = await run(loop, input({ tools: [leaky] }));

      expect(prompts[1].rounds[0].results[0]).toMatchObject({
        failed: true,
        sources: [],
      });
      expect(outcome?.sources).toEqual([]);
      expect(outcome?.entities).toEqual([]);
      expect(outcome?.rounds[0].calls[0].outcome).toBe('foreign_chapter');
    });
  });

  it('goes on without a tool that throws', async () => {
    const broken = tool('search_messages', () =>
      Promise.reject(new Error('the treasurer owes $900')),
    );
    const { loop, prompts } = build([
      round({ toolCalls: [call('search_messages')] }),
      round({ text: 'done' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [broken] }));

    expect(prompts[1].rounds[0].results[0]).toEqual({
      callId: 'call-search_messages',
      sources: [],
      note: 'The read failed.',
      failed: true,
    });
    expect(outcome?.stop).toBe('answered');
    expect(outcome?.rounds[0].calls[0].outcome).toBe('failed');
  });

  describe('its limits', () => {
    it(`makes at most ${AGENT_MAX_ROUNDS} model calls, the last one told to answer`, async () => {
      const { loop, prompts } = build([
        // A model that never stops asking.
        round({ toolCalls: [call('search_messages')] }),
      ]);

      const { outcome } = await run(loop, input());

      expect(prompts).toHaveLength(AGENT_MAX_ROUNDS);
      expect(prompts.map((prompt) => prompt.mustAnswer ?? false)).toEqual([
        ...Array<boolean>(AGENT_MAX_ROUNDS - 1).fill(false),
        true,
      ]);
      expect(outcome?.stop).toBe('round_limit');
      // What the last round asked for is not run, and not handed on.
      expect(outcome?.result).toMatchObject({ status: 'ok', toolCalls: [] });
    });

    it(`runs at most ${AGENT_MAX_CALLS} tool calls, then tells the model to answer`, async () => {
      const search = tool('search_messages');
      const many = Array.from({ length: AGENT_MAX_CALLS + 2 }, (_, index) =>
        call('search_messages', { query: 'dues' }, `call-${index}`),
      );
      const { loop, prompts } = build([
        round({ toolCalls: many }),
        round({ text: 'done' }),
      ]);

      const { outcome } = await run(loop, input({ tools: [search] }));

      expect(search.run).toHaveBeenCalledTimes(AGENT_MAX_CALLS);
      expect(prompts[1].rounds[0].results.slice(-2)).toEqual([
        expect.objectContaining({
          failed: true,
          note: 'The limit on reads was reached.',
        }),
        expect.objectContaining({
          failed: true,
          note: 'The limit on reads was reached.',
        }),
      ]);
      expect(prompts[1].mustAnswer).toBe(true);
      expect(outcome?.stop).toBe('call_limit');
    });

    it('gives a turn asked to think harder more rounds and more reads, and tells every round so', async () => {
      const more = AGENT_LIMITS.more;
      expect(more.rounds).toBeGreaterThan(AGENT_MAX_ROUNDS);
      expect(more.calls).toBeGreaterThan(AGENT_MAX_CALLS);
      expect(more.readBudgetMs).toBeGreaterThan(
        AGENT_LIMITS.default.readBudgetMs,
      );

      const asking = build([round({ toolCalls: [call('search_messages')] })]);
      const rounds = await run(asking.loop, input({ effort: 'more' }));
      expect(asking.prompts).toHaveLength(more.rounds);
      expect(asking.prompts.every((prompt) => prompt.more === true)).toBe(true);
      expect(asking.prompts.at(-1)?.mustAnswer).toBe(true);
      expect(rounds.outcome?.stop).toBe('round_limit');

      const search = tool('search_messages');
      const many = Array.from({ length: more.calls + 1 }, (_, index) =>
        call('search_messages', { query: 'dues' }, `call-${index}`),
      );
      const reading = build([
        round({ toolCalls: many }),
        round({ text: 'done' }),
      ]);
      const calls = await run(
        reading.loop,
        input({ tools: [search], effort: 'more' }),
      );
      expect(search.run).toHaveBeenCalledTimes(more.calls);
      expect(calls.outcome?.stop).toBe('call_limit');
    });

    it('says nothing of more thought on an ordinary turn', async () => {
      const { loop, prompts } = build([round({ text: 'done' })]);
      await run(loop, input());
      expect(prompts[0].more).toBeUndefined();
    });

    it('gives a turn asked to think harder longer to read', async () => {
      let now = 0;
      // Each read takes what an ordinary turn has in all.
      const slow = tool('search_messages', () => {
        now += AGENT_READ_BUDGET_MS;
        return Promise.resolve(found());
      });
      const { loop, prompts } = build([
        round({ toolCalls: [call('search_messages')] }),
        round({ toolCalls: [call('search_messages')] }),
        round({ text: 'done' }),
      ]);

      const { outcome } = await run(
        loop,
        input({ tools: [slow], clock: () => now, effort: 'more' }),
      );

      // Still reading after the first, and stopped by the second.
      expect(prompts[1].mustAnswer ?? false).toBe(false);
      expect(prompts[2].mustAnswer).toBe(true);
      expect(slow.run).toHaveBeenCalledTimes(2);
      expect(outcome?.stop).toBe('time_limit');
    });

    it('tells the model to answer once the read budget is spent', async () => {
      let now = 0;
      const slow = tool('search_messages', () => {
        now += AGENT_READ_BUDGET_MS;
        return Promise.resolve(found());
      });
      const { loop, prompts } = build([
        round({ toolCalls: [call('search_messages')] }),
        round({ text: 'done' }),
      ]);

      const { outcome } = await run(
        loop,
        input({ tools: [slow], clock: () => now }),
      );

      expect(prompts[1].mustAnswer).toBe(true);
      expect(outcome?.stop).toBe('time_limit');
    });

    it('cuts a result to the source and size caps, whole sources only, and says so', async () => {
      const big = tool('search_messages', () =>
        Promise.resolve(
          found({
            sources: [
              source({
                id: 'a',
                text: 'a'.repeat(AGENT_RESULT_MAX_CHARS - 10),
              }),
              source({ id: 'b', text: 'b'.repeat(100) }),
              source({ id: 'c', text: 'short' }),
            ],
          }),
        ),
      );
      const crowd = tool('roster', () =>
        Promise.resolve(
          found({
            sources: Array.from(
              { length: AGENT_RESULT_MAX_SOURCES + 5 },
              (_, index) => source({ id: `m${index}`, text: `line ${index}` }),
            ),
          }),
        ),
      );
      const { loop, prompts } = build([
        round({ toolCalls: [call('search_messages'), call('roster')] }),
        round({ text: 'done' }),
      ]);

      const { outcome } = await run(loop, input({ tools: [big, crowd] }));

      const [first, second] = prompts[1].rounds[0].results;
      expect(first.sources.map((found) => found.id)).toEqual(['a']);
      expect(first.note).toContain('more than fits');
      expect(second.sources).toHaveLength(AGENT_RESULT_MAX_SOURCES);
      expect(second.note).toContain('more than fits');
      expect(outcome?.rounds[0].calls.map((made) => made.cut)).toEqual([
        true,
        true,
      ]);
    });
  });

  it('keeps one text per source id for the whole turn', async () => {
    let reads = 0;
    const search = tool('search_messages', () => {
      reads += 1;
      return Promise.resolve(
        found({
          sources: [
            source({
              text:
                reads === 1
                  ? 'Sam Park: dues are $450'
                  : 'Sam Park (edited): dues are $900',
            }),
          ],
        }),
      );
    });
    const { loop, prompts } = build([
      round({ toolCalls: [call('search_messages')] }),
      round({ toolCalls: [call('search_messages')] }),
      round({ text: 'done' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [search] }));

    const texts = prompts[2].rounds.map(
      (made) => made.results[0].sources[0].text,
    );
    expect(texts).toEqual([
      'Sam Park: dues are $450',
      'Sam Park: dues are $450',
    ]);
    expect(outcome?.sources).toHaveLength(1);
  });

  it('counts left-out messages once per tool, across tools, and says nothing found for an empty read', async () => {
    const counts = [3, 5];
    const empty = tool('search_messages', () =>
      Promise.resolve(
        found({
          sources: [],
          entities: [],
          leftOutMessages: counts.shift() ?? 0,
        }),
      ),
    );
    const other = tool('read_channel', () =>
      Promise.resolve(found({ leftOutMessages: 2 })),
    );
    const { loop, prompts } = build([
      round({ toolCalls: [call('search_messages'), call('read_channel')] }),
      round({ toolCalls: [call('search_messages')] }),
      round({ text: 'done' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [empty, other] }));

    expect(prompts[1].rounds[0].results[0].note).toBe('Nothing found.');
    // Two searches can reach the same conversation: the larger count, not
    // their sum, and the other tool's on top.
    expect(outcome?.leftOutMessages).toBe(7);
  });

  it('cuts a first source that is too long on its own to its leading lines, and checks quotes against the cut', async () => {
    const line = `${'x'.repeat(99)}\n`;
    const long = tool('events', () =>
      Promise.resolve(
        found({
          sources: [
            source({ id: 'tool:events', text: line.repeat(200), chat: false }),
            source({ id: 'tool:other', text: 'short', chat: false }),
          ],
        }),
      ),
    );
    const { loop, prompts } = build([
      round({ toolCalls: [call('events')] }),
      round({ text: 'done' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [long] }));

    const sent = prompts[1].rounds[0].results[0];
    expect(sent.sources).toHaveLength(1);
    expect(sent.sources[0].text.length).toBeLessThanOrEqual(
      AGENT_RESULT_MAX_CHARS,
    );
    expect(sent.sources[0].text.length).toBeGreaterThan(
      AGENT_RESULT_MAX_CHARS - 200,
    );
    // Whole lines only.
    expect(sent.sources[0].text.endsWith('x')).toBe(true);
    expect(sent.note).toContain('more than fits');
    // What the turn keeps as the source is what the model read.
    expect(outcome?.sources.map((kept) => kept.text)).toEqual([
      sent.sources[0].text,
    ]);
  });

  it('ends the turn with the reason when a read was one the gateway would not make', async () => {
    const unavailable = {
      status: 'unavailable',
      reason: 'spend_cap',
      detail: 'chapter_cap',
    } as const;
    const search = tool('search_messages', () =>
      Promise.reject(new AgentToolUnavailableError(unavailable)),
    );
    const { loop, gateway } = build([
      round({ toolCalls: [call('search_messages')] }),
      round({ text: 'never' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [search] }));

    expect(outcome?.stop).toBe('unavailable');
    expect(outcome?.result).toEqual(unavailable);
    expect(gateway.streamAgentRound).toHaveBeenCalledTimes(1);
  });

  it('gives up on a read that outlives the budget, and tells the model to answer', async () => {
    jest.useFakeTimers();
    try {
      const hung = tool('search_messages', () => new Promise(() => undefined));
      const { loop, prompts } = build([
        round({ toolCalls: [call('search_messages')] }),
        round({ text: 'done' }),
      ]);
      let now = 0;
      const running = run(loop, input({ tools: [hung], clock: () => now }));
      await jest.advanceTimersByTimeAsync(AGENT_READ_BUDGET_MS - 1);
      expect(prompts).toHaveLength(1);
      now = AGENT_READ_BUDGET_MS;
      await jest.advanceTimersByTimeAsync(1);
      const { outcome } = await running;

      expect(prompts[1].rounds[0].results[0]).toEqual(
        expect.objectContaining({
          failed: true,
          note: 'The read took too long.',
        }),
      );
      expect(prompts[1].mustAnswer).toBe(true);
      expect(outcome?.stop).toBe('time_limit');
      expect(outcome?.rounds[0].calls[0].outcome).toBe('timed_out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ends the turn when a round is not made', async () => {
    const capped: AiAgentRoundResult = {
      status: 'unavailable',
      reason: 'spend_cap',
      detail: 'member_cap',
    };
    const { loop } = build([
      round({ toolCalls: [call('search_messages')] }),
      capped,
    ]);

    const { outcome } = await run(loop, input());

    expect(outcome).toMatchObject({ stop: 'unavailable', result: capped });
    // What was read before the cap is still reported.
    expect(outcome?.sources).toHaveLength(1);
  });

  it('reads and writes nothing more for a member who left', async () => {
    const controller = new AbortController();
    const search = tool('search_messages', () => {
      controller.abort();
      return Promise.resolve(found());
    });
    const { loop, prompts } = build([
      round({ toolCalls: [call('search_messages')] }),
      round({ text: 'done' }),
    ]);

    const { outcome } = await run(
      loop,
      input({ tools: [search], signal: controller.signal }),
    );

    expect(prompts).toHaveLength(1);
    expect(outcome).toBeUndefined();
  });
});

const card = (id: string): AgentCard =>
  ({
    status: 'proposed',
    action: 'create_task',
    suggestion: { id },
    notes: [],
  }) as unknown as AgentCard;

function proposer(
  propose: AgentProposeTool<{ title: string }>['propose'],
): AgentProposeTool<{ title: string }> & { propose: jest.Mock } {
  return {
    name: 'create_task',
    description: 'Prepares a task card.',
    permission: 'tasks:manage',
    module: 'tasks',
    effect: 'propose',
    input: z.object({ title: z.string() }),
    reading: 'Working out the task',
    propose: jest.fn(propose),
  };
}

const made = (id: string): AgentProposeResult => ({
  chapterId: CHAPTER,
  card: card(id),
  note: 'A card is ready.',
});

describe('AgentLoopService: cards', () => {
  it('runs a propose call, tells the model what came of it, and returns the card', async () => {
    const task = proposer(() => Promise.resolve(made('s1')));
    const { loop, prompts } = build([
      round({ toolCalls: [call('create_task', { title: 'Book the bus' })] }),
      round({ text: 'The card is ready.' }),
    ]);

    const { events, outcome } = await run(
      loop,
      input({ tools: [tool('search_messages'), task] }),
    );

    expect(task.propose).toHaveBeenCalledWith(
      { title: 'Book the bus' },
      expect.objectContaining({ chapterId: CHAPTER, userId: USER }),
    );
    expect(events[0]).toEqual({
      type: 'tool',
      name: 'create_task',
      reading: 'Working out the task',
      effect: 'propose',
    });
    // The model reads the tool's line and no source: a card is not a fact.
    expect(prompts[1].rounds[0].results).toEqual([
      { callId: 'call-create_task', sources: [], note: 'A card is ready.' },
    ]);
    expect(outcome?.cards).toEqual([card('s1')]);
    expect(outcome?.sources).toEqual([]);
    expect(outcome?.rounds[0].calls[0]).toMatchObject({
      tool: 'create_task',
      outcome: 'ok',
      proposed: true,
    });
  });

  it('makes cards one at a time, in the order asked, and no more than the turn may come with', async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const task = proposer(async (args) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      order.push(args.title);
      return made(args.title);
    });
    const { loop, prompts } = build([
      round({
        toolCalls: [
          call('create_task', { title: 'a' }, 'c1'),
          call('create_task', { title: 'b' }, 'c2'),
          call('create_task', { title: 'c' }, 'c3'),
        ],
      }),
      round({ text: 'Done.' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [task], maxCards: 2 }));

    expect(most).toBe(1);
    expect(order).toEqual(['a', 'b']);
    expect(outcome?.cards).toEqual([card('a'), card('b')]);
    expect(prompts[1].rounds[0].results[2]).toEqual({
      callId: 'c3',
      sources: [],
      note: 'No more cards can be made for this answer.',
      failed: true,
    });
    expect(outcome?.rounds[0].calls[2]).toMatchObject({
      tool: 'create_task',
      outcome: 'over_limit',
    });
  });

  it('does not count a propose call that made no card against the limit', async () => {
    const task = proposer((args) =>
      Promise.resolve(
        args.title === 'vague'
          ? {
              chapterId: CHAPTER,
              card: {
                status: 'unclear' as const,
                action: 'create_task',
                missing: 'title' as const,
              },
              note: 'No card was made.',
            }
          : made(args.title),
      ),
    );
    const { loop } = build([
      round({
        toolCalls: [
          call('create_task', { title: 'vague' }, 'c1'),
          call('create_task', { title: 'b' }, 'c2'),
        ],
      }),
      round({ text: 'Done.' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [task], maxCards: 1 }));

    expect(outcome?.cards.map((made) => made.status)).toEqual([
      'unclear',
      'proposed',
    ]);
    expect(outcome?.rounds[0].calls[0]).toMatchObject({ proposed: false });
  });

  it('never runs a propose tool on arguments its schema refused', async () => {
    const task = proposer(() => Promise.resolve(made('s1')));
    const { loop, prompts } = build([
      round({ toolCalls: [call('create_task', { title: 7 })] }),
      round({ text: 'Done.' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [task] }));

    expect(task.propose).not.toHaveBeenCalled();
    expect(prompts[1].rounds[0].results[0]).toMatchObject({ failed: true });
    expect(outcome?.cards).toEqual([]);
  });

  it('refuses a tool that neither reads nor proposes, even when it was offered', async () => {
    const writer = {
      ...tool('delete_everything'),
      effect: 'write',
    } as unknown as AgentReadTool;
    const { loop } = build([
      round({ toolCalls: [call('delete_everything')] }),
      round({ text: 'Done.' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [writer] }));

    expect(
      (writer as unknown as { run: jest.Mock }).run,
    ).not.toHaveBeenCalled();
    expect(outcome?.rounds[0].calls[0]).toMatchObject({
      outcome: 'unknown_tool',
    });
  });

  it('drops a card made in another chapter', async () => {
    const task = proposer(() =>
      Promise.resolve({ ...made('s1'), chapterId: 'chapter-2' }),
    );
    const { loop } = build([
      round({ toolCalls: [call('create_task', { title: 'a' })] }),
      round({ text: 'Done.' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [task] }));

    expect(outcome?.cards).toEqual([]);
    expect(outcome?.rounds[0].calls[0]).toMatchObject({
      outcome: 'foreign_chapter',
    });
  });

  it('goes on without a card whose tool threw', async () => {
    const task = proposer(() => Promise.reject(new Error('database down')));
    const { loop, prompts } = build([
      round({ toolCalls: [call('create_task', { title: 'a' })] }),
      round({ text: 'Done.' }),
    ]);

    const { outcome } = await run(loop, input({ tools: [task] }));

    expect(prompts[1].rounds[0].results[0]).toEqual({
      callId: 'call-create_task',
      sources: [],
      note: 'The card was not made.',
      failed: true,
    });
    expect(outcome?.cards).toEqual([]);
    expect(outcome?.stop).toBe('answered');
  });

  it('still returns a card made beside a read the gateway refused', async () => {
    const task = proposer(() => Promise.resolve(made('s1')));
    const capped = tool('search_messages', () =>
      Promise.reject(
        new AgentToolUnavailableError({
          status: 'unavailable',
          reason: 'spend_cap',
          detail: 'member_cap',
        }),
      ),
    );
    const { loop } = build([
      round({
        toolCalls: [
          call('search_messages'),
          call('create_task', { title: 'a' }),
        ],
      }),
    ]);

    const { outcome } = await run(loop, input({ tools: [capped, task] }));

    expect(outcome?.stop).toBe('unavailable');
    expect(outcome?.cards).toEqual([card('s1')]);
  });

  it('starts no card for a member who has left', async () => {
    const task = proposer(() => Promise.resolve(made('s1')));
    const gone = new AbortController();
    gone.abort();
    const { loop } = build([
      round({ toolCalls: [call('create_task', { title: 'a' })] }),
    ]);

    await run(loop, input({ tools: [task], signal: gone.signal }));

    expect(task.propose).not.toHaveBeenCalled();
  });
});
