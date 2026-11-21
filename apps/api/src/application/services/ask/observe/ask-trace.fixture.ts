import type { AskTraceStep, AskTurnTrace } from './ask-trace';

/** A finished turn as the loop reports it, for the specs here. */
export const ASK = '0a000000-0000-4000-8000-000000004902';
export const CHAPTER = '0b000000-0000-4000-8000-000000004902';
export const USER = '0c000000-0000-4000-8000-000000004902';
export const STARTED = new Date('2026-11-13T20:00:00.000Z');

export const model = (over: Partial<AskTraceStep> = {}): AskTraceStep =>
  ({
    kind: 'model',
    round: 0,
    outcome: 'ok',
    durationMs: 900,
    inputTokens: 1200,
    outputTokens: 80,
    cachedInputTokens: 1000,
    costMicroUsd: 4100,
    ...over,
  }) as AskTraceStep;

export const tool = (over: Partial<AskTraceStep> = {}): AskTraceStep =>
  ({
    kind: 'tool',
    round: 0,
    tool: 'search_messages',
    outcome: 'ok',
    durationMs: 120,
    argBytes: 64,
    resultChars: 3400,
    resultSources: 6,
    ...over,
  }) as AskTraceStep;

export function turn(over: Partial<AskTurnTrace> = {}): AskTurnTrace {
  return {
    askId: ASK,
    chapterId: CHAPTER,
    userId: USER,
    door: 'ask',
    promptVersion: 'ask.answer@v4',
    model: 'claude-sonnet-5-5',
    effort: 'default',
    startedAt: STARTED,
    durationMs: 4200,
    isFollowUp: false,
    outcome: 'answered',
    toolsOffered: ['search_messages', 'read_channel', 'find_member'],
    steps: [model(), tool(), model({ round: 1 })],
    sourcesRead: 6,
    citationsKept: 2,
    citationsDropped: 0,
    readChat: true,
    leftOutMessages: 1,
    proposals: 0,
    truncated: false,
    ...over,
  };
}
