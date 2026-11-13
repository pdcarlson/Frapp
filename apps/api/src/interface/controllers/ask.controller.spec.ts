import { EventEmitter } from 'node:events';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ASK_STREAM_VERSION,
  createAskStreamReader,
  type AskStreamEvent,
} from '@repo/validation';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type { AskConversationEvent } from '../../application/services/ask/ask-conversation.service';
import { reportSwallowed } from '../../infrastructure/observability/report-swallowed';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { AskController, AskDiagnosticsStopController } from './ask.controller';

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
      { kind: 'event', text: 'When and where is Formal?', request: false },
    ]),
  };
  const controller = new AskController(
    askService as never,
    conversation as never,
    diagnostics as never,
    suggestions as never,
  );
  const response = new FakeResponse();
  const ask = (zone?: string, body: Record<string, unknown> = {}) =>
    controller.ask(
      'chapter-a',
      'user-1',
      { events: true },
      zone,
      { question: 'What is quorum?', ...body },
      response as never,
    );
  const stopController = new AskDiagnosticsStopController(diagnostics as never);
  return {
    controller,
    stopController,
    askService,
    conversation,
    diagnostics,
    suggestions,
    response,
    ask,
  };
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
      expect.objectContaining({ history, actions: true }),
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
        { events: true },
        'America/Chicago',
      ),
    ).resolves.toEqual({
      suggestions: [
        { kind: 'event', text: 'When and where is Formal?', request: false },
      ],
    });
    expect(suggestions.suggest).toHaveBeenCalledWith({
      chapterId: 'chapter-a',
      userId: 'user-1',
      enabledModules: { events: true },
      timeZone: 'America/Chicago',
    });
    await controller.openingSuggestions(
      'chapter-a',
      'user-1',
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
