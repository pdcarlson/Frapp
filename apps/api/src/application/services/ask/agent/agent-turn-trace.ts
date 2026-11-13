import {
  aiCatalogEntry,
  aiCostMicroUsd,
  type AiAgentTaskName,
} from '#domain/constants/ai-model-catalog';
import type {
  AskTraceOutcome,
  AskTraceStep,
  AskTraceToolStep,
  AskTurnTrace,
} from '../observe/ask-trace';
import type {
  AgentCallTrace,
  AgentLoopOutcome,
  AgentStop,
} from './agent-loop.service';

/** How a turn through the tool loop ended, for its trace. */
export type AgentTurnEnd =
  /** The loop ran to its end and the member was shown `status`. */
  | {
      kind: 'ended';
      outcome: AgentLoopOutcome;
      status: 'answered' | 'not_found' | 'refused' | 'unavailable';
      citationsKept: number;
      readChat: boolean;
      truncated: boolean;
    }
  /** The member closed the panel or went offline while it worked. */
  | { kind: 'stopped' }
  /** It threw. `errorKind` is one of the loop's own codes, never a message. */
  | { kind: 'error'; errorKind: string };

export interface AgentTurnFacts {
  askId: string;
  chapterId: string;
  userId: string;
  door: string;
  effort: string;
  task: AiAgentTaskName;
  promptVersion: string;
  startedAt: Date;
  durationMs: number;
  isFollowUp: boolean;
  /** The names of the tools the member was offered. */
  toolsOffered: readonly string[];
}

/** The loop's limits, as the trace's `limit` codes. */
const LIMITS: Partial<Record<AgentStop, string>> = {
  round_limit: 'rounds',
  call_limit: 'tool_calls',
  time_limit: 'time',
};

/** The gateway's caps, as the trace's `limit` codes. */
const CAPS: Readonly<Record<string, string>> = {
  member_cap: 'member_limit',
  chapter_cap: 'chapter_limit',
  platform_cap: 'platform_limit',
};

function toolOutcome(call: AgentCallTrace): AskTraceToolStep['outcome'] {
  switch (call.outcome) {
    case 'ok':
      return call.sources > 0 ? 'ok' : 'empty';
    case 'bad_arguments':
      return 'invalid_args';
    case 'foreign_chapter':
      return 'denied';
    case 'unknown_tool':
    case 'over_limit':
      return call.outcome;
    // A read given up on at the time limit is the tool failing to answer.
    case 'failed':
    case 'timed_out':
      return 'error';
  }
}

function stepsOf(
  outcome: AgentLoopOutcome,
  task: AiAgentTaskName,
): AskTraceStep[] {
  const entry = aiCatalogEntry(task);
  // An agent task is a generation task, which is priced by its tokens.
  const cost = (round: { inputTokens: number; outputTokens: number }) =>
    entry.kind === 'transcription' ? 0 : aiCostMicroUsd(entry, round);
  return outcome.rounds.flatMap((round, index): AskTraceStep[] => [
    {
      kind: 'model',
      round: index,
      outcome: round.outcome,
      durationMs: round.ms,
      inputTokens: round.inputTokens,
      outputTokens: round.outputTokens,
      cachedInputTokens: round.cachedInputTokens,
      costMicroUsd: cost(round),
    },
    ...round.calls.map((call): AskTraceToolStep => ({
      kind: 'tool',
      round: index,
      tool: call.outcome === 'unknown_tool' ? null : call.tool,
      outcome: toolOutcome(call),
      durationMs: call.ms,
      argBytes: call.argBytes,
      resultChars: call.chars,
      resultSources: call.sources,
    })),
  ]);
}

/**
 * One turn of the tool loop as `AskTraceService.record` takes it (#4902):
 * names, sizes, counts and codes from the loop's own trace. Nothing the
 * member, a tool or the model wrote is read here, so none can be kept.
 *
 * A turn a limit cut short is `limit` even when the model then wrote an
 * answer with what it had: that is what says the limits are too tight.
 */
export function agentTurnTrace(
  facts: AgentTurnFacts,
  end: AgentTurnEnd,
): AskTurnTrace {
  const base = {
    askId: facts.askId,
    chapterId: facts.chapterId,
    userId: facts.userId,
    door: facts.door,
    promptVersion: facts.promptVersion,
    model: aiCatalogEntry(facts.task).model,
    effort: facts.effort,
    startedAt: facts.startedAt,
    durationMs: facts.durationMs,
    isFollowUp: facts.isFollowUp,
    toolsOffered: facts.toolsOffered,
    proposals: 0,
  };
  if (end.kind !== 'ended') {
    return {
      ...base,
      outcome: end.kind,
      ...(end.kind === 'error' ? { errorKind: end.errorKind } : {}),
      steps: [],
      sourcesRead: 0,
      citationsKept: 0,
      citationsDropped: 0,
      readChat: false,
      leftOutMessages: 0,
      truncated: false,
    };
  }
  const { outcome } = end;
  const result = outcome.result;
  const cap =
    result.status === 'unavailable' && result.detail
      ? CAPS[result.detail]
      : undefined;
  const limit = LIMITS[outcome.stop] ?? cap ?? null;
  const ended: AskTraceOutcome = limit !== null ? 'limit' : end.status;
  return {
    ...base,
    outcome: ended,
    limit,
    steps: stepsOf(outcome, facts.task),
    sourcesRead: outcome.sources.length,
    citationsKept: end.citationsKept,
    citationsDropped: result.status === 'ok' ? result.droppedCitations : 0,
    readChat: end.readChat,
    leftOutMessages: outcome.leftOutMessages,
    truncated: end.truncated,
  };
}
