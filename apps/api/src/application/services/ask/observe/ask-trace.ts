import { ASK_DOORS, ASK_TRACE_RETENTION_DAYS } from '@repo/validation';
import type {
  AskTraceRow,
  AskTraceStepRow,
} from '#domain/entities/ask-trace.entity';

/**
 * What the Ask loop hands `AskTraceService.record` when a turn ends (#4902).
 *
 * **There is no text field here and there must never be one**
 * (`spec/behavior/ai.md` § Stored AI text). A trace says what a turn did in
 * names, sizes and counts: which tools ran, how big their arguments and
 * results were, how long each step took, what it cost and how it ended. It
 * never says what was asked, what a tool was told or what came back. So:
 *
 * - `tool` is the registered name of a tool the loop offered, never a name
 *   the model made up. A call to a name the registry does not hold is
 *   recorded with `tool: null` and `outcome: 'unknown_tool'`.
 * - `errorKind` and `limit` are codes from the loop's own closed sets
 *   (`LanguageModelErrorKind`, the loop's limits), never an error's message.
 * - Sizes are numbers the loop measured: the UTF-8 bytes of the arguments as
 *   the model wrote them, the characters of the result as the model read it.
 *
 * {@link cleanAskTrace} holds every field to that before anything is
 * written: a string that is not a code is replaced, not stored. Where the
 * set of codes is known here it is checked against the set (the door, the
 * effort, the outcomes, and a tool's name against `toolsOffered`); the rest
 * (the model, the prompt version, the limit, the error kind) are checked by
 * shape, which a sentence fails and a single lowercase word does not. Those
 * four must come from the loop's own constants, never from a provider's or
 * a model's output.
 */
export interface AskTurnTrace {
  /** The ask's id: the stream's `start` event and `answer.ask_id`. */
  askId: string;
  /** From `ChapterGuard`. */
  chapterId: string;
  /** The asker, from the auth guard. */
  userId: string;
  /** One of `ASK_DOORS`: where the question was asked from. */
  door: string;
  /** The answer prompt's version, e.g. `ask.answer@v4`. */
  promptVersion: string;
  /** The catalog's model id for the turn's main model. */
  model: string;
  /** `default` or `more` (Think harder). */
  effort: string;
  /** When the turn began. */
  startedAt: Date;
  /** Wall time from the question arriving to the last event sent. */
  durationMs: number;
  /** The question came with earlier turns of the conversation. */
  isFollowUp: boolean;
  outcome: AskTraceOutcome;
  /**
   * With `limit`: which one (`rounds`, `tool_calls`, `member_limit`,
   * `chapter_limit`, `platform_limit`, `output_tokens`). A code.
   */
  limit?: string | null;
  /** With `error`: the failure's kind, e.g. `overloaded`, `timeout`. */
  errorKind?: string | null;
  /**
   * The names of the tools the loop offered the model this turn, from the
   * registry. A tool step's name is kept only when it is one of these.
   */
  toolsOffered: readonly string[];
  /** Every model round and tool call, in the order they happened. */
  steps: readonly AskTraceStep[];
  /** Distinct sources the model was handed across the turn. */
  sourcesRead: number;
  /** Citations that passed the word-for-word check. */
  citationsKept: number;
  /** Citations the check dropped. */
  citationsDropped: number;
  /** Channel messages were among what the model read. */
  readChat: boolean;
  /** Channel messages left out because their authors said no. */
  leftOutMessages: number;
  /** Cards the answer proposed. */
  proposals: number;
  /** The answer hit the length limit and stops early. */
  truncated: boolean;
}

/**
 * How a turn ended.
 *
 * - `answered`, `not_found`, `refused`: the answer's own status.
 * - `limit`: a cap stopped it (`limit` says which) before it could answer.
 * - `unavailable`: no answer was attempted (the answer's `unavailable`).
 * - `proposal`: it ended in a card to confirm instead of an answer.
 * - `stopped`: the member closed the panel or went offline mid-turn.
 * - `error`: it failed after the stream began (`errorKind` says how).
 */
const ASK_TRACE_OUTCOMES = [
  'answered',
  'not_found',
  'refused',
  'limit',
  'unavailable',
  'proposal',
  'stopped',
  'error',
] as const;
export type AskTraceOutcome = (typeof ASK_TRACE_OUTCOMES)[number];

/** One call to the model within the turn. */
export interface AskTraceModelStep {
  kind: 'model';
  /** Which round of the loop, from 0. */
  round: number;
  outcome: 'ok' | 'refused' | 'stopped' | 'error';
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** At the catalog's prices, in millionths of a US dollar. */
  costMicroUsd: number;
}

/**
 * One tool call the model asked for.
 *
 * - `ok`: it ran and returned at least one source.
 * - `empty`: it ran and found nothing.
 * - `invalid_args`: the arguments failed the tool's schema; it did not run.
 * - `denied`: the asker may not use it, or an id in the arguments was not
 *   theirs to open.
 * - `unknown_tool`: the model named a tool the loop does not have.
 * - `over_limit`: the turn had used up its tool calls; it did not run. Not
 *   a failure of the tool.
 * - `stopped`: the turn was stopped while it ran.
 * - `error`: it threw.
 */
export interface AskTraceToolStep {
  kind: 'tool';
  round: number;
  /** The registered tool's name, or null with `unknown_tool`. */
  tool: string | null;
  outcome:
    | 'ok'
    | 'empty'
    | 'invalid_args'
    | 'denied'
    | 'unknown_tool'
    | 'over_limit'
    | 'stopped'
    | 'error';
  durationMs: number;
  /** UTF-8 bytes of the arguments as the model wrote them. */
  argBytes: number;
  /** Characters of the result as the model read it. */
  resultChars: number;
  /** Sources the result carried. */
  resultSources: number;
}

export type AskTraceStep = AskTraceModelStep | AskTraceToolStep;

/**
 * The most steps one trace keeps. A turn asked to think harder is the
 * longest the loop makes: ten rounds, sixteen tool calls and one call past
 * the limit kept (`AGENT_LIMITS`), so twenty-seven; anything past this is a bug
 * upstream, and the trace keeps the first of them instead of failing.
 */
export const ASK_TRACE_MAX_STEPS = 32;

/** Tool outcomes that count as the tool failing, for "the tools that fail". */
const ASK_TRACE_TOOL_FAILURES: ReadonlySet<string> = new Set([
  'invalid_args',
  'denied',
  'unknown_tool',
  'error',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same patterns the migration's checks use, one per column. */
const CODE = /^[a-z][a-z0-9_]{0,31}$/;
/** A prompt's name and version, as every prompt here is named: `ask.answer@v4`. */
const PROMPT_VERSION = /^[a-z][a-z0-9_.-]{0,55}@v[0-9]{1,4}$/;
/** The wire's `effort`: the default, or Think harder. */
const EFFORTS: ReadonlySet<string> = new Set(['default', 'more']);
const DOORS: ReadonlySet<string> = new Set(ASK_DOORS);
const MODEL = /^[a-z0-9][a-z0-9_.:/-]{0,95}$/;
const TOOL = /^[a-z][a-z0-9_]{0,47}$/;
const MODEL_STEP_OUTCOMES = new Set(['ok', 'refused', 'stopped', 'error']);
const TOOL_STEP_OUTCOMES = new Set([
  'ok',
  'empty',
  'invalid_args',
  'denied',
  'unknown_tool',
  'over_limit',
  'stopped',
  'error',
]);
const INT4_MAX = 2_147_483_647;
const INT2_MAX = 32_767;

/** What stands in for a required code that was not one. */
export const ASK_TRACE_UNKNOWN = 'unknown';

function code(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function count(value: unknown, max = INT4_MAX): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function oneOf(value: unknown, set: ReadonlySet<string>): string | null {
  return typeof value === 'string' && set.has(value) ? value : null;
}

function cleanStep(
  traceId: string,
  seq: number,
  step: AskTraceStep,
  toolsOffered: ReadonlySet<string>,
): AskTraceStepRow {
  const base = {
    trace_id: traceId,
    seq,
    round: count(step.round, INT2_MAX),
    duration_ms: count(step.durationMs),
  };
  if (step.kind === 'model') {
    return {
      ...base,
      kind: 'model',
      tool: null,
      outcome: MODEL_STEP_OUTCOMES.has(step.outcome) ? step.outcome : 'error',
      arg_bytes: 0,
      result_chars: 0,
      result_sources: 0,
      input_tokens: count(step.inputTokens),
      output_tokens: count(step.outputTokens),
      cached_input_tokens: count(step.cachedInputTokens),
      cost_micro_usd: count(step.costMicroUsd, Number.MAX_SAFE_INTEGER),
    };
  }
  const tool = oneOf(code(step.tool, TOOL), toolsOffered);
  const outcome = TOOL_STEP_OUTCOMES.has(step.outcome) ? step.outcome : 'error';
  return {
    ...base,
    kind: 'tool',
    // A name the loop did not offer is not kept, whatever the outcome says:
    // it could be something the model wrote.
    tool: outcome === 'unknown_tool' ? null : tool,
    outcome,
    arg_bytes: count(step.argBytes),
    result_chars: count(step.resultChars),
    result_sources: count(step.resultSources),
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cost_micro_usd: 0,
  };
}

/** A trace as its rows, less what only the database read can say. */
export interface CleanAskTrace {
  trace: Omit<AskTraceRow, 'member_id' | 'is_rephrase'>;
  steps: AskTraceStepRow[];
}

/**
 * The rows a trace becomes, with every field held to its shape: ids are
 * ids, codes are codes, counts are whole and not negative. The turn's
 * totals are added up here from its steps, so the loop cannot report a
 * total that disagrees with them. Returns null when the trace does not say
 * whose turn it was, which nothing can stand in for.
 */
export function cleanAskTrace(trace: AskTurnTrace): CleanAskTrace | null {
  if (
    !UUID.test(trace.askId) ||
    !UUID.test(trace.chapterId) ||
    !UUID.test(trace.userId) ||
    !(trace.startedAt instanceof Date) ||
    Number.isNaN(trace.startedAt.getTime())
  ) {
    return null;
  }
  const id = trace.askId.toLowerCase();
  const toolsOffered = new Set(
    Array.isArray(trace.toolsOffered) ? trace.toolsOffered : [],
  );
  const steps = (Array.isArray(trace.steps) ? trace.steps : [])
    .slice(0, ASK_TRACE_MAX_STEPS)
    .map((step, seq) => cleanStep(id, seq, step as AskTraceStep, toolsOffered));
  const models = steps.filter((step) => step.kind === 'model');
  const tools = steps.filter((step) => step.kind === 'tool');
  const sum = (rows: AskTraceStepRow[], key: keyof AskTraceStepRow): number =>
    rows.reduce((total, row) => total + (row[key] as number), 0);
  const outcome = (ASK_TRACE_OUTCOMES as readonly string[]).includes(
    trace.outcome,
  )
    ? trace.outcome
    : 'error';
  return {
    trace: {
      id,
      chapter_id: trace.chapterId.toLowerCase(),
      user_id: trace.userId.toLowerCase(),
      door: oneOf(trace.door, DOORS) ?? ASK_TRACE_UNKNOWN,
      prompt_version:
        code(trace.promptVersion, PROMPT_VERSION) ?? ASK_TRACE_UNKNOWN,
      model: code(trace.model, MODEL) ?? ASK_TRACE_UNKNOWN,
      effort: oneOf(trace.effort, EFFORTS) ?? ASK_TRACE_UNKNOWN,
      outcome,
      limit_kind: outcome === 'limit' ? code(trace.limit, CODE) : null,
      error_kind: outcome === 'error' ? code(trace.errorKind, CODE) : null,
      is_follow_up: trace.isFollowUp === true,
      read_chat: trace.readChat === true,
      truncated: trace.truncated === true,
      rounds: models.length,
      tool_calls: tools.length,
      tool_failures: tools.filter((step) =>
        ASK_TRACE_TOOL_FAILURES.has(step.outcome),
      ).length,
      input_tokens: count(sum(models, 'input_tokens')),
      output_tokens: count(sum(models, 'output_tokens')),
      cached_input_tokens: count(sum(models, 'cached_input_tokens')),
      cost_micro_usd: count(
        sum(models, 'cost_micro_usd'),
        Number.MAX_SAFE_INTEGER,
      ),
      duration_ms: count(trace.durationMs),
      sources_read: count(trace.sourcesRead),
      citations_kept: count(trace.citationsKept),
      citations_dropped: count(trace.citationsDropped),
      left_out_messages: count(trace.leftOutMessages),
      proposals: count(trace.proposals),
      started_at: trace.startedAt.toISOString(),
      expires_at: new Date(
        trace.startedAt.getTime() + ASK_TRACE_RETENTION_DAYS * DAY_MS,
      ).toISOString(),
    },
    steps,
  };
}
