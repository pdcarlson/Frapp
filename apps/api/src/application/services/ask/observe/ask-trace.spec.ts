import {
  ASK_TRACE_MAX_STEPS,
  ASK_TRACE_UNKNOWN,
  cleanAskTrace,
} from './ask-trace';
import {
  ASK,
  CHAPTER,
  STARTED,
  USER,
  model,
  tool,
  turn,
} from './ask-trace.fixture';

describe('cleanAskTrace', () => {
  it('turns a turn into its rows and adds the totals up from the steps', () => {
    const clean = cleanAskTrace(turn());
    expect(clean?.trace).toEqual(
      expect.objectContaining({
        id: ASK,
        chapter_id: CHAPTER,
        user_id: USER,
        door: 'ask',
        prompt_version: 'ask.answer@v4',
        model: 'claude-sonnet-5-5',
        effort: 'default',
        outcome: 'answered',
        limit_kind: null,
        error_kind: null,
        rounds: 2,
        tool_calls: 1,
        tool_failures: 0,
        input_tokens: 2400,
        output_tokens: 160,
        cached_input_tokens: 2000,
        cost_micro_usd: 8200,
        duration_ms: 4200,
        read_chat: true,
        left_out_messages: 1,
        started_at: STARTED.toISOString(),
        expires_at: '2027-02-11T20:00:00.000Z',
      }),
    );
    expect(
      clean?.steps.map((step) => [step.seq, step.kind, step.tool]),
    ).toEqual([
      [0, 'model', null],
      [1, 'tool', 'search_messages'],
      [2, 'model', null],
    ]);
  });

  it('keeps no string that is not a code, wherever it was put', () => {
    const sentence = 'When is the formal? Ask Jordan at jordan@example.com';
    const clean = cleanAskTrace(
      turn({
        door: sentence,
        promptVersion: sentence,
        model: sentence,
        effort: sentence,
        outcome: sentence as never,
        limit: sentence,
        errorKind: sentence,
        steps: [
          model({ outcome: sentence as never }),
          tool({ tool: sentence, outcome: sentence as never }),
          tool({ tool: sentence, outcome: 'unknown_tool' }),
        ],
      }),
    );
    expect(JSON.stringify(clean)).not.toContain('formal');
    expect(JSON.stringify(clean)).not.toContain('jordan');
    expect(clean?.trace).toEqual(
      expect.objectContaining({
        door: ASK_TRACE_UNKNOWN,
        prompt_version: ASK_TRACE_UNKNOWN,
        model: ASK_TRACE_UNKNOWN,
        effort: ASK_TRACE_UNKNOWN,
        outcome: 'error',
        limit_kind: null,
        error_kind: null,
      }),
    );
    expect(clean?.steps.map((step) => [step.tool, step.outcome])).toEqual([
      [null, 'error'],
      [null, 'error'],
      [null, 'unknown_tool'],
    ]);
  });

  it('never keeps the name the model gave a tool the loop did not offer', () => {
    const clean = cleanAskTrace(
      turn({
        steps: [
          tool({ tool: 'find_phone', outcome: 'unknown_tool' }),
          // Shaped like a tool's name, and still not one the loop offered.
          tool({ tool: 'find_phone', outcome: 'error' }),
          tool({ tool: 'read_channel', outcome: 'unknown_tool' }),
        ],
      }),
    );
    expect(clean?.steps.map((step) => [step.tool, step.outcome])).toEqual([
      [null, 'unknown_tool'],
      [null, 'error'],
      [null, 'unknown_tool'],
    ]);
  });

  it('takes a door and an effort only from their own lists', () => {
    const clean = cleanAskTrace(turn({ door: 'lobby', effort: 'maximum' }));
    expect(clean?.trace).toEqual(
      expect.objectContaining({
        door: ASK_TRACE_UNKNOWN,
        effort: ASK_TRACE_UNKNOWN,
      }),
    );
    expect(
      cleanAskTrace(turn({ door: 'chat_private', effort: 'more' }))?.trace,
    ).toEqual(
      expect.objectContaining({ door: 'chat_private', effort: 'more' }),
    );
  });

  it('keeps a limit only on a turn a limit stopped, and an error kind only on an error', () => {
    expect(
      cleanAskTrace(turn({ outcome: 'limit', limit: 'tool_calls' }))?.trace
        .limit_kind,
    ).toBe('tool_calls');
    expect(
      cleanAskTrace(turn({ outcome: 'answered', limit: 'tool_calls' }))?.trace
        .limit_kind,
    ).toBeNull();
    expect(
      cleanAskTrace(turn({ outcome: 'error', errorKind: 'overloaded' }))?.trace
        .error_kind,
    ).toBe('overloaded');
  });

  it('counts the tool outcomes that are failures', () => {
    const clean = cleanAskTrace(
      turn({
        steps: [
          tool({ outcome: 'ok' }),
          tool({ outcome: 'empty' }),
          tool({ outcome: 'invalid_args' }),
          tool({ outcome: 'denied' }),
          tool({ outcome: 'unknown_tool', tool: null }),
          tool({ outcome: 'error' }),
          tool({ outcome: 'stopped' }),
        ],
      }),
    );
    expect(clean?.trace).toEqual(
      expect.objectContaining({ tool_calls: 7, tool_failures: 4, rounds: 0 }),
    );
  });

  it('holds every count to a whole number that is not negative', () => {
    const clean = cleanAskTrace(
      turn({
        durationMs: -5,
        sourcesRead: 2.9,
        citationsKept: Number.NaN,
        citationsDropped: Number.POSITIVE_INFINITY,
        proposals: '3' as never,
        steps: [model({ inputTokens: -1, outputTokens: 1e12, round: 1e9 })],
      }),
    );
    expect(clean?.trace).toEqual(
      expect.objectContaining({
        duration_ms: 0,
        sources_read: 2,
        citations_kept: 0,
        citations_dropped: 0,
        proposals: 0,
        input_tokens: 0,
        output_tokens: 2_147_483_647,
      }),
    );
    expect(clean?.steps[0]?.round).toBe(32_767);
  });

  it('keeps the first steps of a turn that reports too many', () => {
    const clean = cleanAskTrace(
      turn({ steps: Array.from({ length: 80 }, () => tool()) }),
    );
    expect(clean?.steps).toHaveLength(ASK_TRACE_MAX_STEPS);
    expect(clean?.trace.tool_calls).toBe(ASK_TRACE_MAX_STEPS);
  });

  it('refuses a turn that does not say whose it was', () => {
    expect(cleanAskTrace(turn({ askId: 'not-an-id' }))).toBeNull();
    expect(cleanAskTrace(turn({ chapterId: '' }))).toBeNull();
    expect(cleanAskTrace(turn({ userId: 'me' }))).toBeNull();
    expect(cleanAskTrace(turn({ startedAt: new Date('nonsense') }))).toBeNull();
  });
});
