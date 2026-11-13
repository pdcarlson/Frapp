import {
  ASK_STREAM_VERSION,
  type AskAnswer,
  type AskStreamEvent,
} from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import type {
  AiCitedResult,
  AiCitedStreamEvent,
} from '../ai/ai-gateway.service';
import type { CorpusPassage } from '../corpus/corpus-retrieval.service';
import { openAskReportReceipt } from '#domain/utils/ai-report-receipt';
import { parseAiTextKeyRing } from '#domain/utils/ai-text-cipher';
import { AskService, type AskInput } from './ask.service';
import { ASK_ANSWER_NOT_CARRIED } from './ask-prompt';
import type { AskTool } from './ask-tool';

const CHAPTER = 'chapter-a';
const USER = 'user-1';
const NOW = new Date('2026-11-12T18:00:00.000Z');
const USAGE = { inputTokens: 1, outputTokens: 1 };

const input = (over: Partial<AskInput> = {}): AskInput => ({
  chapterId: CHAPTER,
  userId: USER,
  question: 'What is quorum?',
  enabledModules: null,
  timeZone: 'America/New_York',
  savedNoticeShown: false,
  ...over,
});

const passage = (over: Partial<CorpusPassage> = {}): CorpusPassage =>
  ({
    id: 'p1',
    sourceType: 'chapter_document',
    sourceId: 'doc-1',
    title: 'Bylaws',
    heading: 'Article IV',
    text: 'Quorum is two thirds of active members.',
    pageStart: 3,
    pageEnd: 3,
    sourceAt: '2026-09-01T00:00:00.000Z',
    score: 1,
    matchedBy: ['semantic', 'words'],
    channelId: null,
    messageId: null,
    authorIds: [],
    messageCount: null,
    ...over,
  }) satisfies CorpusPassage;

const tool = (over: Partial<AskTool> = {}): AskTool => ({
  name: 'roster',
  description: 'Who is in the chapter.',
  kind: 'roster',
  title: 'Roster',
  page: 'members',
  permission: SystemPermissions.MEMBERS_VIEW,
  module: null,
  effect: 'read',
  run: jest.fn(async () => ({
    chapterId: CHAPTER,
    text: 'Dana Reyes: Treasurer',
  })),
  ...over,
});

const ok = (over: Partial<Extract<AiCitedResult, { status: 'ok' }>> = {}) =>
  ({
    status: 'ok',
    text: 'Quorum is two thirds of active members.',
    citations: [
      { sourceId: 'p1', quote: 'Quorum is two thirds of active members.' },
    ],
    droppedCitations: 0,
    truncated: false,
    usage: USAGE,
    ...over,
  }) as AiCitedResult;

function build(options: {
  passages?: CorpusPassage[];
  leftOutMessages?: number;
  retrieved?: unknown;
  tools?: AskTool[];
  permissions?: string[];
  plan?: unknown;
  planThrows?: Error;
  answer?: AiCitedResult;
  deltas?: string[];
  kept?: boolean;
  saidNo?: string[];
}) {
  const retrieval = {
    retrieve: jest.fn(
      async () =>
        options.retrieved ?? {
          status: 'ok',
          passages: options.passages ?? [],
          leftOutMessages: options.leftOutMessages ?? 0,
        },
    ),
  };
  const gateway = {
    generateObject: jest.fn(async () => {
      if (options.planThrows) throw options.planThrows;
      return (
        options.plan ?? { status: 'ok', value: { tools: [] }, usage: USAGE }
      );
    }),
    streamCited: jest.fn(
      async function* (): AsyncGenerator<AiCitedStreamEvent> {
        for (const delta of options.deltas ?? ['Quorum is ']) {
          yield { type: 'text', delta };
        }
        yield { type: 'end', result: options.answer ?? ok() };
      },
    ),
  };
  const consent = {
    check: jest.fn(async () => ({ allowed: true })),
    chatAuthorsWhoSaidYes: jest.fn(
      async (_chapterId: string, authors: readonly string[]) =>
        new Set(authors.filter((author) => !options.saidNo?.includes(author))),
    ),
  };
  const rbac = {
    getEffectivePermissions: jest.fn(
      async () => options.permissions ?? [SystemPermissions.MEMBERS_VIEW],
    ),
  };
  const diagnostics = { keep: jest.fn(async () => options.kept ?? false) };
  const service = new AskService(
    retrieval as never,
    gateway as never,
    consent as never,
    rbac as never,
    diagnostics as never,
    options.tools ?? [],
  );
  return { service, retrieval, gateway, consent, rbac, diagnostics };
}

async function run(
  service: AskService,
  over: Partial<AskInput> = {},
): Promise<{ events: AskStreamEvent[]; answer: AskAnswer }> {
  const events: AskStreamEvent[] = [];
  for await (const event of service.ask(input(over), NOW)) events.push(event);
  const done = events.at(-1);
  if (done?.type !== 'done') throw new Error('the stream did not end in done');
  return { events, answer: done.answer };
}

describe('AskService', () => {
  describe('an answer from a document', () => {
    it('streams the steps and the words, then the checked answer with its source', async () => {
      const { service } = build({ passages: [passage()] });
      const { events, answer } = await run(service);

      expect(events.map((event) => event.type)).toEqual([
        'start',
        'status',
        'status',
        'status',
        'text',
        'done',
      ]);
      expect(
        events.flatMap((event) =>
          event.type === 'status' ? [event.step] : [],
        ),
      ).toEqual(['searching', 'reading', 'writing']);
      expect(answer).toEqual({
        status: 'answered',
        reason: null,
        text: 'Quorum is two thirds of active members.',
        citations: [
          {
            source: 0,
            at: 'Quorum is two thirds of active members.'.length,
            quote: 'Quorum is two thirds of active members.',
          },
        ],
        sources: [
          {
            id: 'p1',
            kind: 'document',
            title: 'Bylaws',
            detail: 'Article IV, page 3',
            date: '2026-09-01T00:00:00.000Z',
            target: { type: 'document', document_id: 'doc-1', page: 3 },
          },
        ],
        left_out_messages: 0,
        unverified_citations: 0,
        truncated: false,
        saved: false,
        read_chat: false,
        report_receipt: null,
      });
    });

    it('searches as the asker, in the chapter the guard resolved', async () => {
      const { service, retrieval, gateway } = build({ passages: [passage()] });
      await run(service);
      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER,
          actingUserId: USER,
          query: 'What is quorum?',
        }),
        NOW,
      );
      expect(gateway.streamCited).toHaveBeenCalledWith(
        'ask.answer',
        expect.objectContaining({
          messages: [{ role: 'user', content: 'What is quorum?' }],
        }),
        { chapterId: CHAPTER, actingUserId: USER },
      );
    });

    it('sends only the sources a kept citation names, numbered in the order cited', async () => {
      const { service } = build({
        passages: [
          passage(),
          passage({ id: 'p2', sourceId: 'doc-2', title: 'House rules' }),
          passage({
            id: 'p3',
            sourceType: 'meeting_minutes',
            sourceId: 'meeting-1',
            title: 'Chapter meeting minutes',
            heading: null,
            pageStart: null,
            pageEnd: null,
            text: 'Dues are $400 this semester.',
          }),
        ],
        answer: ok({
          text: 'Dues are $400 this semester. Quorum is two thirds of active members.',
          citations: [
            { sourceId: 'p3', quote: 'Dues are $400 this semester.' },
            {
              sourceId: 'p1',
              quote: 'Quorum is two thirds of active members.',
            },
          ],
        }),
      });
      const { answer } = await run(service);
      expect(answer.sources.map((source) => source.id)).toEqual(['p3', 'p1']);
      expect(answer.sources[0]).toEqual(
        expect.objectContaining({
          kind: 'minutes',
          detail: null,
          target: { type: 'meeting', meeting_id: 'meeting-1' },
        }),
      );
      expect(answer.citations.map((citation) => citation.source)).toEqual([
        0, 1,
      ]);
    });

    it('passes on that the answer was cut short and that a quote was dropped', async () => {
      const { service } = build({
        passages: [passage()],
        answer: ok({ truncated: true, droppedCitations: 2 }),
      });
      const { answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({
          status: 'answered',
          truncated: true,
          unverified_citations: 2,
        }),
      );
    });
  });

  describe('what it says it is doing (#4701)', () => {
    const steps = (events: AskStreamEvent[]) =>
      events.flatMap((event) => (event.type === 'status' ? [event] : []));

    it('names the live reads it picked and counts each source the search found once', async () => {
      const { service } = build({
        tools: [tool()],
        plan: { status: 'ok', value: { tools: ['roster'] }, usage: USAGE },
        passages: [
          passage(),
          // A second passage of the same document, and one of another.
          passage({ id: 'p2' }),
          passage({ id: 'p3', sourceId: 'doc-2', title: 'Risk policy' }),
        ],
      });
      const { events } = await run(service);
      expect(steps(events)[1]).toEqual({
        v: ASK_STREAM_VERSION,
        type: 'status',
        step: 'reading',
        reads: ['roster'],
        found: 2,
      });
    });

    it('never says it is reading when the search found nothing and no read was picked', async () => {
      const { service } = build({ passages: [] });
      const { events } = await run(service);
      expect(steps(events).map((event) => event.step)).toEqual(['searching']);
    });

    it('says it is writing at the first word, and never for an answer that was not written', async () => {
      const written = build({
        passages: [passage()],
        deltas: ['Quorum ', 'is'],
      });
      expect(
        (await run(written.service)).events.map((event) =>
          event.type === 'status' ? event.step : event.type,
        ),
      ).toEqual([
        'start',
        'searching',
        'reading',
        'writing',
        'text',
        'text',
        'done',
      ]);

      const unwritten = build({
        passages: [passage()],
        deltas: [],
        answer: { status: 'refused', category: null },
      });
      expect(
        steps((await run(unwritten.service)).events).map((event) => event.step),
      ).toEqual(['searching', 'reading']);
    });
  });

  describe('a turn that may not go past its search', () => {
    it('asks once the search and the plan are back, and ends with nothing run, kept or written', async () => {
      const roster = tool();
      const { service, retrieval, gateway, diagnostics, consent } = build({
        tools: [roster],
        plan: { status: 'ok', value: { tools: ['roster'] }, usage: USAGE },
        passages: [passage()],
      });
      const mayGoOn = jest.fn(async () => {
        expect(retrieval.retrieve).toHaveBeenCalledTimes(1);
        expect(gateway.generateObject).toHaveBeenCalledTimes(1);
        return false;
      });
      const events: AskStreamEvent[] = [];
      for await (const event of service.ask(
        input({ mayGoOn, savedNoticeShown: true }),
        NOW,
      )) {
        events.push(event);
      }
      expect(mayGoOn).toHaveBeenCalledTimes(1);
      expect(
        events.map((event) =>
          event.type === 'status' ? event.step : event.type,
        ),
      ).toEqual(['start', 'searching']);
      expect(roster.run).not.toHaveBeenCalled();
      expect(consent.chatAuthorsWhoSaidYes).not.toHaveBeenCalled();
      expect(gateway.streamCited).not.toHaveBeenCalled();
      expect(diagnostics.keep).not.toHaveBeenCalled();
    });

    it('goes on to the answer when it is told it may', async () => {
      const { service } = build({ passages: [passage()] });
      const { answer } = await run(service, { mayGoOn: async () => true });
      expect(answer.status).toBe('answered');
    });

    it('is held even when the search could not run, so nothing is said for a turn that is a card', async () => {
      const { service } = build({
        retrieved: {
          status: 'unavailable',
          reason: 'spend_cap',
          detail: 'member_cap',
        },
      });
      const events: AskStreamEvent[] = [];
      for await (const event of service.ask(
        input({ mayGoOn: async () => false }),
        NOW,
      )) {
        events.push(event);
      }
      expect(events.some((event) => event.type === 'done')).toBe(false);
    });
  });

  describe('a question inside a conversation', () => {
    const history = [
      { question: 'When is the next chapter meeting?', answer: '' },
      {
        question: 'What is quorum?',
        answer: 'Quorum is two thirds of active members.',
      },
    ];

    it('searches the follow-up beside the question before it', async () => {
      const { service, retrieval } = build({ passages: [passage()] });
      await run(service, { question: 'And for a vote to expel?', history });
      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'What is quorum?\nAnd for a vote to expel?',
        }),
        NOW,
      );
    });

    it('shows the planner what the member asked before, and never an answer', async () => {
      const { service, gateway } = build({
        passages: [passage()],
        tools: [tool()],
      });
      await run(service, { question: 'And for a vote to expel?', history });
      const [, request] = gateway.generateObject.mock.calls[0] as unknown as [
        string,
        { messages: Array<{ role: string; content: string }> },
      ];
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].content).toBe(
        [
          'Earlier in the conversation the member asked:',
          '- When is the next chapter meeting?',
          '- What is quorum?',
          '',
          'Question: And for a vote to expel?',
          '',
          'Tools:',
          '- roster: Who is in the chapter.',
        ].join('\n'),
      );
      expect(request.messages[0].content).not.toContain('two thirds');
    });

    it('gives the answer call the earlier turns as turns, ending on the question, and keeps the question of a turn whose answer is not carried', async () => {
      const { service, gateway } = build({ passages: [passage()] });
      await run(service, { question: 'And for a vote to expel?', history });
      const [, request] = gateway.streamCited.mock.calls[0] as unknown as [
        string,
        { messages: Array<{ role: string; content: string }> },
      ];
      expect(request.messages).toEqual([
        { role: 'user', content: 'When is the next chapter meeting?' },
        { role: 'assistant', content: ASK_ANSWER_NOT_CARRIED },
        { role: 'user', content: 'What is quorum?' },
        {
          role: 'assistant',
          content: 'Quorum is two thirds of active members.',
        },
        { role: 'user', content: 'And for a vote to expel?' },
      ]);
    });

    it('drops half a character a cut left in an earlier turn, which a provider would refuse', async () => {
      const { service, gateway } = build({ passages: [passage()] });
      await run(service, {
        question: 'And after that?',
        history: [
          { question: 'Formal \ud83c', answer: 'At the Hilton.\ud83c' },
        ],
      });
      const [, request] = gateway.streamCited.mock.calls[0] as unknown as [
        string,
        { messages: Array<{ role: string; content: string }> },
      ];
      expect(request.messages.slice(0, 2)).toEqual([
        { role: 'user', content: 'Formal ' },
        { role: 'assistant', content: 'At the Hilton.' },
      ]);
    });

    it('still answers only from this question’s sources: an earlier answer backs nothing', async () => {
      const { service } = build({
        passages: [passage()],
        answer: ok({ text: 'Three quarters, as I said.', citations: [] }),
      });
      const { answer } = await run(service, {
        question: 'And for a vote to expel?',
        history,
      });
      expect(answer.status).toBe('not_found');
    });

    it('a first question is searched and sent as it always was', async () => {
      const { service, retrieval, gateway } = build({ passages: [passage()] });
      await run(service);
      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'What is quorum?' }),
        NOW,
      );
      const [, request] = gateway.streamCited.mock.calls[0] as unknown as [
        string,
        { messages: unknown[] },
      ];
      expect(request.messages).toEqual([
        { role: 'user', content: 'What is quorum?' },
      ]);
    });
  });

  describe('no answer without a source', () => {
    it('answers "couldn’t find that" without calling a model when nothing was found', async () => {
      const { service, gateway } = build({ passages: [] });
      const { events, answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({ status: 'not_found', text: '', sources: [] }),
      );
      expect(gateway.streamCited).not.toHaveBeenCalled();
      expect(events.some((event) => event.type === 'text')).toBe(false);
    });

    it('replaces what the model wrote when no quote of it was found in a source', async () => {
      const { service } = build({
        passages: [passage()],
        deltas: ['Quorum is whatever the president says.'],
        answer: ok({
          text: 'Quorum is whatever the president says.',
          citations: [],
          droppedCitations: 1,
        }),
      });
      const { answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({
          status: 'not_found',
          text: '',
          citations: [],
          sources: [],
          unverified_citations: 1,
        }),
      );
    });

    it('says so when the provider declined the question', async () => {
      const { service } = build({
        passages: [passage()],
        deltas: [],
        answer: { status: 'refused', category: null },
      });
      const { answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({ status: 'refused', text: '' }),
      );
    });
  });

  describe('when no answer can be attempted', () => {
    it.each([
      [{ reason: 'consent', detail: 'chapter_off' }, 'chapter_off'],
      [{ reason: 'consent', detail: 'member_declined' }, 'consent_required'],
      [{ reason: 'spend_cap', detail: 'chapter_cap' }, 'chapter_limit'],
      [{ reason: 'spend_cap', detail: 'member_cap' }, 'member_limit'],
      [{ reason: 'spend_cap', detail: 'platform_cap' }, 'not_available'],
      [{ reason: 'not_configured' }, 'not_available'],
      [{ reason: 'disabled' }, 'not_available'],
    ])('the search answering %j is told as %s', async (unavailable, reason) => {
      const { service, gateway } = build({
        retrieved: { status: 'unavailable', ...unavailable },
      });
      const { answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({ status: 'unavailable', reason }),
      );
      expect(gateway.streamCited).not.toHaveBeenCalled();
    });

    it('the answer call refused for the member’s daily limit is told as that', async () => {
      const { service } = build({
        passages: [passage()],
        deltas: [],
        answer: {
          status: 'unavailable',
          reason: 'spend_cap',
          detail: 'member_cap',
        },
      });
      const { answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({
          status: 'unavailable',
          reason: 'member_limit',
        }),
      );
    });
  });

  describe('live data', () => {
    const planning = (names: string[]) => ({
      status: 'ok',
      value: { tools: names },
      usage: USAGE,
    });

    it('runs the tool the plan picked, as the asker, and cites it like a document', async () => {
      const roster = tool();
      const { service, gateway } = build({
        tools: [roster],
        plan: planning(['roster']),
        answer: ok({
          text: 'Dana Reyes is the treasurer.',
          citations: [
            { sourceId: 'tool:roster', quote: 'Dana Reyes: Treasurer' },
          ],
        }),
      });
      const { answer } = await run(service, { question: 'Who is treasurer?' });

      expect(roster.run).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        userId: USER,
        now: NOW,
        timeZone: 'America/New_York',
      });
      expect(answer.sources).toEqual([
        {
          id: 'tool:roster',
          kind: 'roster',
          title: 'Roster',
          detail: null,
          date: null,
          target: { type: 'page', page: 'members' },
        },
      ]);
      // The planner is shown the question and the tool list, nothing found.
      const planCall = gateway.generateObject.mock.calls[0] as unknown as [
        string,
        { messages: Array<{ content: string }> },
      ];
      expect(planCall[0]).toBe('ask.plan');
      expect(planCall[1].messages[0].content).toContain('Who is treasurer?');
      expect(planCall[1].messages[0].content).not.toContain('Quorum');
    });

    it('puts live data first, then the official record, then chat', async () => {
      const { service, gateway } = build({
        tools: [tool()],
        plan: planning(['roster']),
        passages: [
          passage({
            id: 'chat-1',
            sourceType: 'chat_message',
            title: '#general',
            heading: null,
            pageStart: null,
            pageEnd: null,
            authorIds: ['author-1'],
            messageCount: 1,
          }),
          passage(),
        ],
      });
      await run(service);
      const call = gateway.streamCited.mock.calls[0] as unknown as [
        string,
        { sources: Array<{ id: string; title: string }> },
      ];
      expect(call[1].sources.map((source) => source.id)).toEqual([
        'tool:roster',
        'p1',
        'chat-1',
      ]);
      expect(call[1].sources[2].title).toBe(
        // The asker's day, like the "Today is" line: midnight UTC on
        // September 1 is still August 31 in New York.
        'Chat message in #general, Monday, August 31, 2026',
      );
    });

    it('never offers a tool the asker lacks the permission for', async () => {
      const roster = tool();
      const { service, gateway } = build({
        tools: [roster],
        permissions: [SystemPermissions.AI_USE],
        plan: planning(['roster']),
      });
      await run(service);
      expect(gateway.generateObject).not.toHaveBeenCalled();
      expect(roster.run).not.toHaveBeenCalled();
    });

    it('never offers a tool whose module the chapter has off', async () => {
      const events = tool({ name: 'events', module: 'events' });
      const { service } = build({
        tools: [events],
        plan: planning(['events']),
      });
      await run(service, { enabledModules: { events: false } });
      expect(events.run).not.toHaveBeenCalled();
    });

    it('never runs a tool that changes something, whatever the plan says', async () => {
      const acting = tool({ name: 'create_task', effect: 'propose' });
      const { service, gateway } = build({
        tools: [acting],
        plan: planning(['create_task']),
      });
      await run(service);
      expect(gateway.generateObject).not.toHaveBeenCalled();
      expect(acting.run).not.toHaveBeenCalled();
    });

    it('ignores a tool name the plan made up, and runs at most three', async () => {
      const tools = ['a', 'b', 'c', 'd'].map((name) => tool({ name }));
      const { service } = build({
        tools,
        plan: planning(['a', 'b', 'c', 'd', 'delete_everything']),
      });
      await run(service);
      expect(tools.map((t) => (t.run as jest.Mock).mock.calls.length)).toEqual([
        1, 1, 1, 0,
      ]);
    });

    it('drops a result that belongs to another chapter', async () => {
      const leaky = tool({
        run: jest.fn(async () => ({
          chapterId: 'chapter-b',
          text: 'Someone else: President',
        })),
      });
      const { service, gateway } = build({
        tools: [leaky],
        plan: planning(['roster']),
      });
      const { answer } = await run(service);
      expect(gateway.streamCited).not.toHaveBeenCalled();
      expect(answer.status).toBe('not_found');
    });

    it('answers from the search when the plan fails, is refused or is malformed', async () => {
      for (const scenario of [
        { planThrows: new LanguageModelError('timeout', 'anthropic') },
        { plan: { status: 'refused', category: null } },
        { plan: { status: 'invalid_output' } },
      ]) {
        const roster = tool();
        const { service } = build({
          tools: [roster],
          passages: [passage()],
          ...scenario,
        });
        const { answer } = await run(service);
        expect(answer.status).toBe('answered');
        expect(roster.run).not.toHaveBeenCalled();
      }
    });

    it('answers without a tool that failed', async () => {
      const broken = tool({
        run: jest.fn(async () => {
          throw new Error('database');
        }),
      });
      const { service } = build({
        tools: [broken],
        plan: planning(['roster']),
        passages: [passage()],
      });
      const { answer } = await run(service);
      expect(answer.status).toBe('answered');
    });
  });

  describe('chat', () => {
    const chat = (over: Partial<CorpusPassage> = {}) =>
      passage({
        id: 'chat-1',
        sourceType: 'chat_message',
        sourceId: 'window-1',
        title: '#general',
        heading: null,
        pageStart: null,
        pageEnd: null,
        text: 'Formal is at the Hilton this year.',
        channelId: 'channel-1',
        messageId: 'message-1',
        authorIds: ['author-1'],
        messageCount: 2,
        ...over,
      });

    it('links a chat source to its first message, and counts what was left out', async () => {
      const { service } = build({
        passages: [chat()],
        leftOutMessages: 3,
        answer: ok({
          text: 'Formal is at the Hilton this year.',
          citations: [
            { sourceId: 'chat-1', quote: 'Formal is at the Hilton this year.' },
          ],
        }),
      });
      const { answer } = await run(service);
      expect(answer.left_out_messages).toBe(3);
      expect(answer.read_chat).toBe(true);
      expect(answer.sources[0]).toEqual(
        expect.objectContaining({
          kind: 'chat',
          title: '#general',
          target: {
            type: 'message',
            channel_id: 'channel-1',
            message_id: 'message-1',
          },
        }),
      );
    });

    it('says the model read chat even when the answer cites none of it, so the client never sends the answer back', async () => {
      const { service } = build({
        passages: [chat(), passage()],
        answer: ok({
          text: 'Quorum is two thirds of active members. Formal is at the Hilton.',
          citations: [
            {
              sourceId: 'p1',
              quote: 'Quorum is two thirds of active members.',
            },
          ],
        }),
      });
      const { answer } = await run(service);
      expect(answer.sources.map((source) => source.kind)).not.toContain('chat');
      expect(answer.read_chat).toBe(true);
    });

    it('says the model read no chat when it was given none', async () => {
      const { service } = build({ passages: [passage()] });
      const { answer } = await run(service);
      expect(answer.status).toBe('answered');
      expect(answer.read_chat).toBe(false);
    });

    it('drops a passage whose author said No since the search, before the model sees it, and counts its messages', async () => {
      const { service, gateway, consent } = build({
        passages: [chat(), passage()],
        leftOutMessages: 1,
        saidNo: ['author-1'],
      });
      const { answer } = await run(service);
      expect(consent.chatAuthorsWhoSaidYes).toHaveBeenCalledWith(CHAPTER, [
        'author-1',
      ]);
      const call = gateway.streamCited.mock.calls[0] as unknown as [
        string,
        { sources: Array<{ id: string }> },
      ];
      expect(call[1].sources.map((source) => source.id)).toEqual(['p1']);
      expect(answer.left_out_messages).toBe(3);
    });

    it('still says how many messages were left out when nothing was found', async () => {
      const { service } = build({ passages: [], leftOutMessages: 2 });
      const { answer } = await run(service);
      expect(answer).toEqual(
        expect.objectContaining({ status: 'not_found', left_out_messages: 2 }),
      );
    });
  });

  describe('the diagnostics window', () => {
    it('keeps nothing unless the client showed the notice', async () => {
      const { service, diagnostics } = build({ passages: [passage()] });
      const { answer } = await run(service);
      expect(diagnostics.keep).not.toHaveBeenCalled();
      expect(answer.saved).toBe(false);
    });

    it('hands the exchange to the window when the notice was shown, and says it was kept', async () => {
      const { service, diagnostics } = build({
        passages: [passage()],
        kept: true,
      });
      const { answer } = await run(service, { savedNoticeShown: true });
      expect(answer.saved).toBe(true);
      expect(diagnostics.keep).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        expect.objectContaining({
          question: 'What is quorum?',
          status: 'answered',
          answer: 'Quorum is two thirds of active members.',
          sources: [
            { kind: 'document', title: 'Bylaws', detail: 'Article IV, page 3' },
          ],
          tools: [],
        }),
        NOW,
      );
    });

    it('never keeps an answer that had chat in front of the model', async () => {
      const { service, diagnostics } = build({
        passages: [
          passage(),
          passage({
            id: 'chat-1',
            sourceType: 'chat_message',
            title: '#general',
            authorIds: ['author-1'],
          }),
        ],
      });
      await run(service, { savedNoticeShown: true });
      expect(diagnostics.keep).not.toHaveBeenCalled();
    });

    it('never keeps an ask that was not attempted', async () => {
      const { service, diagnostics } = build({
        passages: [passage()],
        deltas: [],
        answer: {
          status: 'unavailable',
          reason: 'spend_cap',
          detail: 'member_cap',
        },
      });
      await run(service, { savedNoticeShown: true });
      expect(diagnostics.keep).not.toHaveBeenCalled();
    });
  });

  describe('assertMayAsk', () => {
    it('passes a member the consent check allows', async () => {
      const { service, consent } = build({});
      await expect(
        service.assertMayAsk(CHAPTER, USER),
      ).resolves.toBeUndefined();
      expect(consent.check).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER,
          actingUserId: USER,
          task: 'ask.answer',
          family: 'ask',
        }),
      );
    });

    it.each([
      ['chapter_off', 'ai.chapter_off'],
      ['member_declined', 'ai.consent.required'],
    ])('refuses %s with %s before any stream', async (reason, code) => {
      const { service, consent } = build({});
      consent.check.mockResolvedValue({ allowed: false, reason } as never);
      await expect(service.assertMayAsk(CHAPTER, USER)).rejects.toMatchObject({
        response: expect.objectContaining({ code }),
      });
    });
  });

  describe('the report receipt (#4315)', () => {
    const KEY = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
    const ring = parseAiTextKeyRing(KEY);
    const saved = process.env.AI_STORED_TEXT_KEY;
    afterEach(() => {
      if (saved === undefined) delete process.env.AI_STORED_TEXT_KEY;
      else process.env.AI_STORED_TEXT_KEY = saved;
    });

    it('is null when the server holds no key, so nothing could be kept', async () => {
      delete process.env.AI_STORED_TEXT_KEY;
      const { service } = build({ passages: [passage()] });
      const { answer } = await run(service);
      expect(answer.report_receipt).toBeNull();
    });

    it('seals the exchange as the model saw it and the member was shown it, for this asker only', async () => {
      process.env.AI_STORED_TEXT_KEY = KEY;
      const chat = passage({
        id: 'p2',
        sourceType: 'chat_message',
        sourceId: 'window-1',
        title: 'general',
        text: 'Dana: quorum is two thirds',
        channelId: 'channel-1',
        messageId: 'message-1',
        authorIds: ['dana', USER],
        messageCount: 1,
      });
      const { service } = build({ passages: [passage(), chat] });
      const { events, answer } = await run(service);
      const start = events[0];
      if (start.type !== 'start') throw new Error('no start');
      expect(answer.report_receipt).toEqual(expect.any(String));
      // The text is not readable in the envelope.
      expect(answer.report_receipt).not.toContain('Quorum');

      const receipt = openAskReportReceipt(
        ring,
        answer.report_receipt!,
        { chapterId: CHAPTER, userId: USER },
        NOW,
      );
      expect(receipt).toEqual(
        expect.objectContaining({
          ask_id: start.ask_id,
          question: 'What is quorum?',
          written: 'Quorum is two thirds of active members.',
          tools: [],
          // The chat author is quoted; the asker is not.
          quoted_user_ids: ['dana'],
        }),
      );
      expect(receipt.shown.text).toBe(answer.text);
      expect(receipt.given.map((given) => given.text)).toEqual([
        'Quorum is two thirds of active members.',
        'Dana: quorum is two thirds',
      ]);
      // Another member, or another chapter, cannot open it.
      expect(() =>
        openAskReportReceipt(
          ring,
          answer.report_receipt!,
          { chapterId: CHAPTER, userId: 'someone-else' },
          NOW,
        ),
      ).toThrow('invalid');
      expect(() =>
        openAskReportReceipt(
          ring,
          answer.report_receipt!,
          { chapterId: 'chapter-b', userId: USER },
          NOW,
        ),
      ).toThrow('invalid');
    });

    it('carries no receipt when no answer was attempted', async () => {
      process.env.AI_STORED_TEXT_KEY = KEY;
      const { service } = build({
        retrieved: { status: 'unavailable', reason: 'consent', detail: null },
      });
      const { answer } = await run(service);
      expect(answer.status).toBe('unavailable');
      expect(answer.report_receipt).toBeNull();
    });
  });
});
