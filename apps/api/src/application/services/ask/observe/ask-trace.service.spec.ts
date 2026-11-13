import { assertContentFreeProperties } from '@repo/validation';
import type {
  AskTraceRow,
  AskTraceStepRow,
} from '#domain/entities/ask-trace.entity';
import { reportSwallowed } from '../../../../infrastructure/observability/report-swallowed';
import { turn } from './ask-trace.fixture';
import {
  ASK_TOOL_EVENT,
  ASK_TURN_EVENT,
  AskTraceService,
} from './ask-trace.service';

jest.mock('../../../../infrastructure/observability/report-swallowed', () => ({
  reportSwallowed: jest.fn(),
}));

type Listener = (userId: string) => Promise<void>;

function build(
  over: {
    member?: { id: string } | null;
    last?: string | null;
    answer?: 'yes' | 'no' | null;
    kept?: boolean;
  } = {},
) {
  const inserted: { trace: AskTraceRow; steps: AskTraceStepRow[] }[] = [];
  const listeners: Listener[] = [];
  const traces = {
    insertTrace: jest.fn(
      async (trace: AskTraceRow, steps: readonly AskTraceStepRow[]) => {
        inserted.push({ trace, steps: [...steps] });
        return over.kept ?? true;
      },
    ),
    lastStartedAt: jest.fn(async () => over.last ?? null),
    deleteTrace: jest.fn(async () => true),
    deleteByUser: jest.fn(async () => 1),
    deleteExpired: jest.fn(async () => 3),
  };
  const members = {
    findByUserAndChapter: jest.fn(async () =>
      over.member === undefined ? { id: 'member-1' } : over.member,
    ),
  };
  const consent = {
    onConsentWithdrawn: (listener: Listener) => listeners.push(listener),
    getConsentState: jest.fn(async () => ({
      answer: over.answer === undefined ? 'yes' : over.answer,
    })),
  };
  const analytics = { track: jest.fn(async () => undefined) };
  const service = new AskTraceService(
    traces as never,
    members as never,
    consent as never,
    analytics as never,
  );
  service.onModuleInit();
  return { service, traces, members, consent, analytics, inserted, listeners };
}

describe('AskTraceService', () => {
  beforeEach(() => jest.mocked(reportSwallowed).mockClear());

  it('keeps the turn under the asker’s membership, with its steps', async () => {
    const { service, inserted } = build();
    await expect(service.record(turn())).resolves.toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.trace).toEqual(
      expect.objectContaining({
        member_id: 'member-1',
        is_rephrase: false,
        rounds: 2,
        tool_calls: 1,
      }),
    );
    expect(inserted[0]?.steps).toHaveLength(3);
  });

  it('marks a question asked within a minute of the member’s last one', async () => {
    const soon = build({ last: '2026-11-13T19:59:20.000Z' });
    await soon.service.record(turn());
    expect(soon.inserted[0]?.trace.is_rephrase).toBe(true);

    const later = build({ last: '2026-11-13T19:58:59.000Z' });
    await later.service.record(turn());
    expect(later.inserted[0]?.trace.is_rephrase).toBe(false);
  });

  it('sends one event for the turn and one per tool call, none with content', async () => {
    const { service, analytics } = build();
    await service.record(turn());
    const calls = analytics.track.mock.calls as unknown as [
      string,
      string,
      { chapterId: string; properties: Record<string, unknown> },
    ][];
    expect(calls.map((call) => call[0])).toEqual([
      ASK_TURN_EVENT,
      ASK_TOOL_EVENT,
    ]);
    for (const [name, , options] of calls) {
      expect(() =>
        assertContentFreeProperties({
          name,
          properties: options.properties as never,
        }),
      ).not.toThrow();
    }
    expect(calls[0]?.[2].properties).toEqual(
      expect.objectContaining({
        outcome: 'answered',
        prompt_version: 'ask.answer@v4',
        tool_calls: 1,
        cost_micro_usd: 8200,
      }),
    );
    expect(calls[1]?.[2].properties).toEqual(
      expect.objectContaining({ tool: 'search_messages', outcome: 'ok' }),
    );
  });

  it('keeps nothing for a member who left the chapter while it was written', async () => {
    const { service, traces, analytics } = build({ member: null });
    await expect(service.record(turn())).resolves.toBe(false);
    expect(traces.insertTrace).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('takes the trace back out when the member said No while it was written', async () => {
    const { service, traces, analytics } = build({ answer: 'no' });
    await expect(service.record(turn())).resolves.toBe(false);
    expect(traces.deleteTrace).toHaveBeenCalledWith(
      turn().askId,
      turn().chapterId,
    );
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('a sheet the member has yet to answer again costs this trace only, not their earlier ones', async () => {
    const { service, traces } = build({ answer: null });
    await expect(service.record(turn())).resolves.toBe(false);
    expect(traces.deleteTrace).toHaveBeenCalledTimes(1);
    expect(traces.deleteByUser).not.toHaveBeenCalled();
  });

  it('a No on the AI sheet deletes the member’s traces', async () => {
    const { traces, listeners } = build();
    expect(listeners).toHaveLength(1);
    await listeners[0]?.('user-9');
    expect(traces.deleteByUser).toHaveBeenCalledWith('user-9');
  });

  it('never throws: a failed write is reported and the turn goes on', async () => {
    const { service, traces } = build();
    traces.insertTrace.mockRejectedValueOnce(new Error('db down'));
    await expect(service.record(turn())).resolves.toBe(false);
    expect(reportSwallowed).toHaveBeenCalledTimes(1);
  });

  it('keeps the row when only the events fail to send', async () => {
    const { service, analytics } = build();
    analytics.track.mockRejectedValueOnce(new Error('posthog down'));
    await expect(service.record(turn())).resolves.toBe(true);
  });

  it('keeps nothing, and says so, for a turn that does not say whose it was', async () => {
    const { service, traces } = build();
    await expect(service.record(turn({ userId: 'nobody' }))).resolves.toBe(
      false,
    );
    expect(traces.insertTrace).not.toHaveBeenCalled();
    expect(reportSwallowed).toHaveBeenCalledTimes(1);
  });

  it('the sweep deletes what has run out', async () => {
    const { service, traces } = build();
    const now = new Date('2027-03-01T00:00:00.000Z');
    await expect(service.sweep(now)).resolves.toBe(3);
    expect(traces.deleteExpired).toHaveBeenCalledWith(now);
  });
});
