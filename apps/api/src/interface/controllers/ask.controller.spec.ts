import { EventEmitter } from 'node:events';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ASK_STREAM_VERSION,
  assertContentFreeProperties,
  createAskStreamReader,
  type AnalyticsProperties,
  type AskStreamEvent,
} from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type { AskConversationEvent } from '../../application/services/ask/ask-conversation.service';
import { reportSwallowed } from '../../infrastructure/observability/report-swallowed';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import {
  ASK_QUESTION_EVENT,
  AskController,
  AskDiagnosticsStopController,
} from './ask.controller';

jest.mock('../../infrastructure/observability/report-swallowed', () => ({
  reportSwallowed: jest.fn(),
}));

class FakeResponse extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';
  ended = false;
  flushed = false;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  set(headers: Record<string, string>): this {
    Object.assign(this.headers, headers);
    return this;
  }
  flushHeaders(): void {
    this.flushed = true;
  }
  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }
  end(): void {
    this.ended = true;
  }
  events(): AskStreamEvent[] {
    return createAskStreamReader().feed(this.body);
  }
}

const done: AskStreamEvent = {
  v: ASK_STREAM_VERSION,
  type: 'done',
  answer: {
    status: 'not_found',
    reason: null,
    text: '',
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  },
};

function build(
  stream: (input: {
    signal?: AbortSignal;
  }) => AsyncGenerator<AskConversationEvent>,
) {
  const askService = {
    assertMayAsk: jest.fn(async () => undefined),
  };
  const conversation = { converse: jest.fn(stream) };
  const diagnostics = {
    view: jest.fn(async () => ({
      offered: true,
      can_change: false,
      ends_at: '2026-11-26T18:00:00.000Z',
    })),
    start: jest.fn(async () => ({
      offered: true,
      can_change: true,
      ends_at: 'x',
    })),
    stop: jest.fn(async () => ({
      offered: true,
      can_change: true,
      ends_at: null,
    })),
  };
  const suggestions = {
    suggest: jest.fn(async () => [
      {
        kind: 'event',
        text: 'When and where is Formal on Friday?',
        request: false,
      },
    ]),
  };
  const analytics = { track: jest.fn(async () => undefined) };
  const controller = new AskController(
    askService as never,
    conversation as never,
    diagnostics as never,
    suggestions as never,
    analytics as never,
  );
  const response = new FakeResponse();
  const ask = (
    zone?: string,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) =>
    controller.ask(
      'chapter-a',
      'user-1',
      { events: true },
      zone,
      { question: 'What is quorum?', ...body },
      response as never,
      { headers },
    );
  const stopController = new AskDiagnosticsStopController(diagnostics as never);
  return {
    controller,
    stopController,
    askService,
    conversation,
    diagnostics,
    suggestions,
    analytics,
    response,
    ask,
  };
}

/** The level of the one event the last `reportSwallowed` call built. */
function reportedLevel(): unknown {
  const call = jest.mocked(reportSwallowed).mock.calls.at(-1);
  const build = call?.[2] as (() => { level?: unknown }) | undefined;
  return build?.().level;
}

describe('AskController', () => {
  beforeEach(() => jest.mocked(reportSwallowed).mockClear());

  it('writes each event as one Server-Sent Events frame and ends the response', async () => {
    const { ask, response, conversation } = build(async function* () {
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      yield { v: ASK_STREAM_VERSION, type: 'text', delta: 'Two\nthirds' };
      yield done;
    });
    await ask('America/Chicago', { saved_notice_shown: true });

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.headers['X-Accel-Buffering']).toBe('no');
    expect(response.flushed).toBe(true);
    expect(response.events().map((event) => event.type)).toEqual([
      'start',
      'text',
      'done',
    ]);
    expect(response.ended).toBe(true);
    expect(conversation.converse).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: 'chapter-a',
        userId: 'user-1',
        question: 'What is quorum?',
        enabledModules: { events: true },
        timeZone: 'America/Chicago',
        savedNoticeShown: true,
        // A build that only knows answers never gets a proposal.
        actions: false,
      }),
    );
    const [input] = conversation.converse.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect('history' in input).toBe(false);
  });

  it('passes the conversation and the client’s say that it shows cards', async () => {
    const { ask, conversation } = build(async function* () {
      yield done;
    });
    const history = [{ question: 'Who is the treasurer?', answer: 'Dana.' }];
    await ask(undefined, { history, actions: true });
    expect(conversation.converse).toHaveBeenCalledWith(
      expect.objectContaining({ history, actions: true, answerCards: false }),
    );
    // And its say that it draws the cards an answer comes with.
    await ask(undefined, { actions: true, answer_cards: true });
    expect(conversation.converse).toHaveBeenLastCalledWith(
      expect.objectContaining({ actions: true, answerCards: true }),
    );
  });

  it('ends the stream with the proposal, in the shape the request route answers with', async () => {
    const { ask, response } = build(async function* () {
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      yield {
        type: 'act',
        outcome: {
          status: 'unclear',
          action: 'give_points',
          missing: 'amount',
        },
      };
    });
    await ask(undefined, { actions: true });
    expect(response.events().at(-1)).toEqual({
      v: ASK_STREAM_VERSION,
      type: 'proposal',
      act: {
        status: 'unclear',
        action: 'give_points',
        suggestion: null,
        notes: [],
        event_choice: null,
        missing: 'amount',
        reason: null,
        available_actions: [],
      },
    });
    expect(response.ended).toBe(true);
  });

  it('falls back to a known time zone, and treats a missing notice flag as not shown', async () => {
    const { ask, conversation } = build(async function* () {
      yield done;
    });
    await ask('Mars/Olympus');
    const [input] = conversation.converse.mock.calls[0] as unknown as [
      { timeZone: string; savedNoticeShown: boolean },
    ];
    expect(input.timeZone).not.toBe('Mars/Olympus');
    expect(input.savedNoticeShown).toBe(false);
  });

  it('never takes the saved notice as shown for a question from a channel (#4713)', async () => {
    const { ask, conversation } = build(async function* () {
      yield done;
    });
    // A channel's turn asked again from the Ask card carries the card's
    // flag; the channel showed no notice, so nothing of it is kept.
    await ask(undefined, { door: 'chat_private', saved_notice_shown: true });
    await ask(undefined, { door: 'ask', saved_notice_shown: true });
    const kept = conversation.converse.mock.calls.map(
      (call) =>
        (call as unknown as [{ savedNoticeShown: boolean }])[0]
          .savedNoticeShown,
    );
    expect(kept).toEqual([false, true]);
  });

  it('counts the question by its door, with none of its words (#4713)', async () => {
    const { ask, analytics } = build(async function* () {
      yield done;
    });
    await ask(
      undefined,
      {
        door: 'chat_private',
        history: [{ question: 'What is quorum?', answer: 'Two thirds.' }],
      },
      { origin: 'https://app.frapp.live' },
    );
    expect(analytics.track).toHaveBeenCalledTimes(1);
    const [name, userId, options] = analytics.track.mock
      .calls[0] as unknown as [
      string,
      string,
      { chapterId: string; properties: AnalyticsProperties },
    ];
    expect(name).toBe(ASK_QUESTION_EVENT);
    expect(userId).toBe('user-1');
    expect(options.chapterId).toBe('chapter-a');
    expect(options.properties).toEqual({
      door: 'chat_private',
      is_follow_up: true,
    });
    expect(() =>
      assertContentFreeProperties({ name, properties: options.properties }),
    ).not.toThrow();
  });

  it('counts a question from a build that names no door as Ask’s own screen', async () => {
    const { ask, analytics } = build(async function* () {
      yield done;
    });
    await ask();
    const [, , options] = analytics.track.mock.calls[0] as unknown as [
      string,
      string,
      { properties: Record<string, unknown> },
    ];
    expect(options.properties).toEqual({ door: 'ask', is_follow_up: false });
  });

  it('answers all the same when the count cannot be sent', async () => {
    const { ask, analytics, response } = build(async function* () {
      yield done;
    });
    analytics.track.mockRejectedValueOnce(new Error('posthog down'));
    await ask();
    expect(response.events().map((event) => event.type)).toEqual(['done']);
  });

  it('refuses before the stream opens when the member may not ask', async () => {
    const { ask, askService, conversation, response } = build(
      async function* () {
        yield done;
      },
    );
    askService.assertMayAsk.mockRejectedValueOnce(
      new ForbiddenException({ code: 'ai.consent.required' }),
    );
    await expect(ask()).rejects.toBeInstanceOf(ForbiddenException);
    expect(response.flushed).toBe(false);
    expect(response.body).toBe('');
    expect(conversation.converse).not.toHaveBeenCalled();
  });

  it('ends a stream that broke with one error event, and reports it', async () => {
    const { ask, response } = build(async function* () {
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      throw new LanguageModelError('overloaded', 'anthropic');
    });
    await ask();
    const events = response.events();
    expect(events.at(-1)).toEqual({
      v: ASK_STREAM_VERSION,
      type: 'error',
      code: 'ai.ask.failed',
      retryable: new LanguageModelError('overloaded', 'anthropic').retryable,
    });
    expect(response.ended).toBe(true);
    expect(reportSwallowed).toHaveBeenCalledTimes(1);
    // The provider's weather, retried and offered again: a warning.
    expect(reportedLevel()).toBe('warning');
  });

  it('reports a stream that broke on our side at error level', async () => {
    const { ask, response } = build(async function* () {
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      throw new TypeError('cannot read properties of undefined');
    });
    await ask();
    expect(response.events().at(-1)).toMatchObject({
      type: 'error',
      retryable: true,
    });
    expect(reportedLevel()).toBe('error');
  });

  it('reports a provider refusal that Try again cannot fix at error level', async () => {
    const { ask } = build(async function* () {
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      throw new LanguageModelError('invalid_request', 'anthropic');
    });
    await ask();
    expect(reportedLevel()).toBe('error');
  });

  it('keeps a timeout at error level: it can be ours (egress, a short timeout)', async () => {
    const { ask } = build(async function* () {
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      throw new LanguageModelError('timeout', 'anthropic');
    });
    await ask();
    expect(reportedLevel()).toBe('error');
  });

  it('stops quietly when the member went away: aborts the work, writes no error, reports nothing', async () => {
    let seen: AbortSignal | undefined;
    const { ask, response } = build(async function* (input) {
      seen = input.signal;
      yield { v: ASK_STREAM_VERSION, type: 'start', ask_id: 'a' };
      response.emit('close');
      throw new LanguageModelError('aborted', 'anthropic');
    });
    await ask();
    expect(seen?.aborted).toBe(true);
    expect(response.events().map((event) => event.type)).toEqual(['start']);
    expect(reportSwallowed).not.toHaveBeenCalled();
    expect(response.ended).toBe(true);
  });

  it('opening suggestions are read for the caller, in their zone, with no consent check and no model', async () => {
    const { controller, suggestions, askService, conversation } = build(
      async function* () {
        yield done;
      },
    );
    await expect(
      controller.openingSuggestions(
        'chapter-a',
        'user-1',
        { id: 'member-1', role_ids: ['role-brother'] },
        { events: true },
        'America/Chicago',
      ),
    ).resolves.toEqual({
      suggestions: [
        {
          kind: 'event',
          text: 'When and where is Formal on Friday?',
          request: false,
        },
      ],
    });
    expect(suggestions.suggest).toHaveBeenCalledWith({
      chapterId: 'chapter-a',
      userId: 'user-1',
      roleIds: ['role-brother'],
      enabledModules: { events: true },
      timeZone: 'America/Chicago',
    });
    await controller.openingSuggestions(
      'chapter-a',
      'user-1',
      { id: 'member-1', role_ids: [] },
      null,
      'Not/A_Zone',
    );
    expect(suggestions.suggest).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZone: 'America/New_York' }),
    );
    expect(askService.assertMayAsk).not.toHaveBeenCalled();
    expect(conversation.converse).not.toHaveBeenCalled();
  });

  it('status tells the panel when saving ends', async () => {
    const { controller, diagnostics } = build(async function* () {
      yield done;
    });
    await expect(
      controller.status('chapter-a', { role_ids: ['r'] } as never),
    ).resolves.toEqual({
      saved_until: '2026-11-26T18:00:00.000Z',
      diagnostics: {
        offered: true,
        can_change: false,
        ends_at: '2026-11-26T18:00:00.000Z',
      },
    });
    expect(diagnostics.view).toHaveBeenCalledWith(
      'chapter-a',
      ['r'],
      expect.any(Date),
    );
  });

  it('passes the caller’s roles to the window’s start and stop, which decide who may', async () => {
    const { controller, stopController, diagnostics } = build(
      async function* () {
        yield done;
      },
    );
    const member = { role_ids: ['role-president'] } as never;
    await controller.startDiagnostics('chapter-a', 'user-1', member);
    expect(diagnostics.start).toHaveBeenCalledWith(
      'chapter-a',
      { userId: 'user-1', roleIds: ['role-president'] },
      expect.any(Date),
    );
    await stopController.stopDiagnostics('chapter-a', 'user-1', member);
    expect(diagnostics.stop).toHaveBeenCalledWith('chapter-a', {
      userId: 'user-1',
      roleIds: ['role-president'],
    });
  });
});

describe('AskDiagnosticsStopController (#4504)', () => {
  const guardsOf = (target: object): unknown[] =>
    (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];

  it('lets a president end a window while AI is off: no server switch, no ai:use', () => {
    expect(guardsOf(AskDiagnosticsStopController)).toEqual([
      SupabaseAuthGuard,
      ChapterGuard,
    ]);
    // Every other Ask route still answers 404 while AI is off.
    expect(guardsOf(AskController)[0]).toBe(AiEnabledGuard);
  });
});
