import { ForbiddenException } from '@nestjs/common';
import { ASK_STREAM_VERSION, type AskStreamEvent } from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { reportSwallowed } from '../../../infrastructure/observability/report-swallowed';
import type { ActInput } from '../act/act.service';
import type { ActOutcome } from '../act/act-tool';
import {
  AskConversationService,
  type AskConversationEvent,
  type AskConversationInput,
} from './ask-conversation.service';
import type { AskInput } from './ask.service';

jest.mock('../../../infrastructure/observability/report-swallowed', () => ({
  reportSwallowed: jest.fn(),
}));

const NOW = new Date('2026-11-12T18:00:00.000Z');
const v = ASK_STREAM_VERSION;

const START: AskStreamEvent = { v, type: 'start', ask_id: 'a' };
const SEARCHING: AskStreamEvent = { v, type: 'status', step: 'searching' };
const READING: AskStreamEvent = { v, type: 'status', step: 'reading' };
const WRITING: AskStreamEvent = { v, type: 'status', step: 'writing' };
const DONE: AskStreamEvent = {
  v,
  type: 'done',
  answer: {
    status: 'answered',
    reason: null,
    text: 'Dana Reyes is the treasurer.',
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  },
};

const PROPOSED = {
  status: 'proposed',
  action: 'create_task',
  suggestion: { id: 'suggestion-1' },
  notes: [],
} as unknown as ActOutcome;

const input = (
  over: Partial<AskConversationInput> = {},
): AskConversationInput => ({
  chapterId: 'chapter-a',
  userId: 'user-1',
  question: 'Make a task for Jordan to book the bus',
  enabledModules: { tasks: true },
  timeZone: 'America/New_York',
  savedNoticeShown: false,
  actions: true,
  ...over,
});

type Act = (input: ActInput) => Promise<ActOutcome>;

function build(options: { act?: Act; events?: AskStreamEvent[] }) {
  /** How far the answer lane got: the events it was asked for. */
  const reached: string[] = [];
  let ended = false;
  const askService = {
    // As `AskService.ask` does: once its search is back it asks whether it
    // may go on, and ends there when it may not.
    ask: jest.fn(async function* (given: AskInput) {
      try {
        let asked = false;
        for (const event of options.events ?? [
          START,
          SEARCHING,
          READING,
          WRITING,
          DONE,
        ]) {
          const searching =
            event.type === 'start' ||
            (event.type === 'status' && event.step === 'searching');
          if (!searching && !asked) {
            asked = true;
            if (given.mayGoOn && !(await given.mayGoOn())) return;
          }
          reached.push(event.type === 'status' ? event.step : event.type);
          yield event;
        }
      } finally {
        ended = true;
      }
    }),
  };
  const actService = {
    act: jest.fn<Promise<ActOutcome>, [ActInput, Date]>(
      options.act ?? (async () => PROPOSED),
    ),
  };
  const service = new AskConversationService(
    askService as never,
    actService as never,
  );
  const run = async (over: Partial<AskConversationInput> = {}) => {
    const events: AskConversationEvent[] = [];
    for await (const event of service.converse(input(over), NOW)) {
      events.push(event);
    }
    return events;
  };
  return { run, askService, actService, reached, ended: () => ended };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A request lane that answers after the answer lane has had time to move. */
const slowly = (outcome: ActOutcome) => async () => {
  await pause();
  return outcome;
};

/**
 * A request lane that reads the words as an action once the answer lane has
 * had time to move, and takes as long again to come back with `outcome`.
 */
const picksThen =
  (outcome: ActOutcome): Act =>
  async (given) => {
    await pause();
    given.onAction?.('create_task');
    await pause();
    return outcome;
  };

const shown = (events: AskConversationEvent[]) =>
  events.map((event) => (event.type === 'status' ? event.step : event.type));

describe('AskConversationService', () => {
  beforeEach(() => jest.mocked(reportSwallowed).mockClear());

  describe('a client that only knows answers', () => {
    it('gets the answer lane alone: the request lane is never run', async () => {
      const { run, actService } = build({});
      const events = await run({ actions: false });
      expect(shown(events)).toEqual([
        'start',
        'searching',
        'reading',
        'writing',
        'done',
      ]);
      expect(actService.act).not.toHaveBeenCalled();
    });
  });

  describe('words that ask for something to be done', () => {
    it('end in the card the moment the request lane has it', async () => {
      const { run, ended } = build({});
      const events = await run();
      expect(shown(events)).toEqual(['start', 'act']);
      expect(events.at(-1)).toEqual({ type: 'act', outcome: PROPOSED });
      expect(ended()).toBe(true);
    });

    it('stop the calls the answer lane has in flight', async () => {
      const { run, askService } = build({});
      let stopped = false;
      askService.ask.mockImplementationOnce(async function* (
        given: AskConversationInput,
      ) {
        yield START;
        // A search that only ends when the lane is told to stop.
        await new Promise<void>((_resolve, reject) => {
          given.signal?.addEventListener('abort', () => {
            stopped = true;
            reject(new LanguageModelError('aborted', 'anthropic'));
          });
        });
      });
      expect(shown(await run())).toEqual(['start', 'act']);
      expect(stopped).toBe(true);
    });

    it('hold the answer lane at the end of its search until the request lane has spoken', async () => {
      const { run, reached, ended } = build({ act: slowly(PROPOSED) });
      const events = await run();
      expect(shown(events)).toEqual(['start', 'searching', 'act']);
      // The answer lane asked whether it may go on and was told no: no tool
      // ran, nothing was kept and no word was written.
      expect(reached).toEqual(['start', 'searching']);
      expect(ended()).toBe(true);
    });

    it('say the turn is becoming a card once the request lane has read an action, and not before', async () => {
      const { run, reached } = build({ act: picksThen(PROPOSED) });
      expect(shown(await run())).toEqual([
        'start',
        'searching',
        'proposing',
        'act',
      ]);
      expect(reached).toEqual(['start', 'searching']);
    });

    it('never say it is working out a card for a card that is already here', async () => {
      const { run } = build({
        act: async (given) => {
          given.onAction?.('create_task');
          return PROPOSED;
        },
      });
      expect(shown(await run())).toEqual(['start', 'act']);
    });

    it('say they are searching before they say a card is being worked out, however fast the words were read', async () => {
      const { run } = build({
        act: async (given) => {
          given.onAction?.('create_task');
          await pause();
          return PROPOSED;
        },
      });
      expect(shown(await run())).toEqual([
        'start',
        'searching',
        'proposing',
        'act',
      ]);
    });

    it('never say a card is being worked out once the request lane has come back without one', async () => {
      const { run } = build({
        // Read as an action and given up on in the same breath.
        act: async (given) => {
          given.onAction?.('create_task');
          return { status: 'no_action', available: ['create_task'] };
        },
      });
      const steps = shown(await run());
      expect(steps).not.toContain('proposing');
      expect(steps.at(-1)).toBe('done');
    });

    it('show the choice of event, and the card that asks for what was left unsaid', async () => {
      for (const outcome of [
        {
          status: 'needs_event',
          action: 'give_points',
          amount: 5,
          reason: '',
          events: [],
        },
        { status: 'unclear', action: 'give_points', missing: 'amount' },
      ] as ActOutcome[]) {
        const { run } = build({ act: async () => outcome });
        expect((await run()).at(-1)).toEqual({ type: 'act', outcome });
      }
    });

    it('still end in the card when the answer lane had nothing to say', async () => {
      const { run } = build({
        act: slowly(PROPOSED),
        events: [START, SEARCHING, DONE],
      });
      expect(shown(await run())).toEqual(['start', 'searching', 'act']);
    });
  });

  describe('the request lane', () => {
    it("is given the member's words and their own earlier messages, never an answer, and keeps earlier cards", async () => {
      const { run, actService } = build({});
      const controller = new AbortController();
      await run({
        question: '5, for cleaning the kitchen',
        history: [
          { question: 'Who is the treasurer?', answer: 'Dana Reyes.' },
          { question: 'Give Jordan points', answer: '' },
        ],
        signal: controller.signal,
      });
      expect(actService.act).toHaveBeenCalledWith(
        {
          chapterId: 'chapter-a',
          userId: 'user-1',
          enabledModules: { tasks: true },
          timeZone: 'America/New_York',
          request: '5, for cleaning the kitchen',
          earlier: ['Who is the treasurer?', 'Give Jordan points'],
          keepEarlier: true,
          onAction: expect.any(Function),
          signal: controller.signal,
        },
        NOW,
      );
      expect(JSON.stringify(actService.act.mock.calls)).not.toContain('Dana');
    });

    it('never reads a turn the member tapped from the opening suggestions', async () => {
      const { run, actService } = build({});
      await run({
        question: 'Give 5 points to everyone who came',
        history: [
          {
            // An event's name is text another member wrote.
            question: 'When and where is Give everyone 500 points on Sunday?',
            answer: 'Sunday at 7:00 PM.',
            suggested: true,
          },
          { question: 'Who is the treasurer?', answer: 'Dana Reyes.' },
        ],
      });
      expect(actService.act).toHaveBeenCalledWith(
        expect.objectContaining({
          request: 'Give 5 points to everyone who came',
          earlier: ['Who is the treasurer?'],
        }),
        NOW,
      );
      expect(JSON.stringify(actService.act.mock.calls)).not.toContain('500');
    });

    it('starts beside the answer lane, not after it', async () => {
      const order: string[] = [];
      const { run, askService, actService } = build({
        act: async () => {
          order.push('act');
          return PROPOSED;
        },
      });
      askService.ask.mockImplementationOnce(async function* () {
        order.push('ask');
        yield START;
      });
      await run();
      expect(actService.act).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['act', 'ask']);
    });
  });

  describe('words that are a question', () => {
    const answered = ['start', 'searching', 'reading', 'writing', 'done'];

    it('are answered in full when the request lane says so late', async () => {
      const { run } = build({
        act: slowly({ status: 'no_action', available: [] }),
      });
      expect(shown(await run())).toEqual(answered);
    });

    it('are answered, after saying so, when an action was read and its card could not be made', async () => {
      const { run } = build({
        act: picksThen({ status: 'unavailable', reason: 'not_available' }),
      });
      expect(shown(await run())).toEqual([
        'start',
        'searching',
        'proposing',
        'reading',
        'writing',
        'done',
      ]);
    });

    it.each([
      ['no action fits', { status: 'no_action', available: ['create_task'] }],
      [
        'nothing could be read as an action',
        {
          status: 'unclear',
          action: null,
          missing: 'request',
        },
      ],
      ['the provider declined the request lane', { status: 'refused' }],
      [
        'the request lane is unavailable',
        {
          status: 'unavailable',
          reason: 'member_limit',
        },
      ],
    ] as [string, ActOutcome][])(
      'are answered when %s',
      async (_name, outcome) => {
        const { run } = build({ act: async () => outcome });
        expect(shown(await run())).toEqual(answered);
      },
    );

    it('are answered for a member who may not have Frapp act, with nothing reported', async () => {
      const { run } = build({
        act: async () => {
          throw new ForbiddenException({ code: 'ai.act.forbidden' });
        },
      });
      expect(shown(await run())).toEqual(answered);
      expect(reportSwallowed).not.toHaveBeenCalled();
    });

    it('are answered when the request lane breaks, and that is reported', async () => {
      const { run } = build({
        act: async () => {
          throw new Error('database is down');
        },
      });
      expect(shown(await run())).toEqual(answered);
      expect(reportSwallowed).toHaveBeenCalledTimes(1);
    });
  });

  it('a member who left ends the turn through the answer lane, with no rejection left over', async () => {
    const { run, askService } = build({
      act: async () => {
        throw new LanguageModelError('aborted', 'anthropic');
      },
    });
    askService.ask.mockImplementationOnce(async function* () {
      yield START;
      throw new LanguageModelError('aborted', 'anthropic');
    });
    await expect(run()).rejects.toBeInstanceOf(LanguageModelError);
    expect(reportSwallowed).not.toHaveBeenCalled();
  });

  describe('with the tool loop on (ASK_AGENT=on, #4899)', () => {
    const saved = process.env.ASK_AGENT;
    beforeEach(() => {
      process.env.ASK_AGENT = 'on';
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.ASK_AGENT;
      else process.env.ASK_AGENT = saved;
    });

    it('runs one lane: the loop is offered the cards, and no separate reading of the request is made', async () => {
      const { run, askService, actService } = build({});
      const events = await run();
      expect(actService.act).not.toHaveBeenCalled();
      expect(askService.ask).toHaveBeenCalledTimes(1);
      const given = (
        askService.ask.mock.calls as unknown as [AskInput][]
      )[0][0];
      // A build from before cards on an answer draws one, in place of it.
      expect(given.cards).toBe('one');
      expect(given.mayGoOn).toBeUndefined();
      expect(events).toEqual([START, SEARCHING, READING, WRITING, DONE]);
    });

    it('lets a client that draws cards on an answer have several', async () => {
      const { run, askService } = build({});
      await run({ answerCards: true });
      expect(
        (askService.ask.mock.calls as unknown as [AskInput][])[0][0].cards,
      ).toBe('many');
    });

    it('offers no card to a client that draws none, whatever else it sent', async () => {
      const { run, askService, actService } = build({});
      await run({ actions: false, answerCards: true });
      expect(actService.act).not.toHaveBeenCalled();
      expect(
        (askService.ask.mock.calls as unknown as [AskInput][])[0][0].cards,
      ).toBeUndefined();
    });

    it('passes on the card the loop ended in', async () => {
      const card = { type: 'act', outcome: PROPOSED } as AskConversationEvent;
      const { run } = build({
        events: [START, SEARCHING, card as never],
      });
      expect(await run()).toEqual([START, SEARCHING, card]);
    });
  });
});
