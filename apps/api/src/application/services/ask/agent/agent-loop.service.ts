import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ASK_PROPOSALS_MAX, type AskEffort } from '@repo/validation';
import type { AiCallContext } from '#domain/adapters/ai-call-context';
import {
  LanguageModelError,
  type LanguageModelAgentRound,
  type LanguageModelMessage,
  type LanguageModelSource,
  type LanguageModelTool,
  type LanguageModelToolCall,
  type LanguageModelToolResult,
} from '#domain/adapters/language-model.interface';
import type { AiAgentTaskName } from '#domain/constants/ai-model-catalog';
import { reportCaughtFailure } from '../../../../infrastructure/observability/report-caught-failure';
import {
  AiGatewayService,
  type AiAgentRoundResult,
} from '../../ai/ai-gateway.service';
import {
  AGENT_RESULT_MAX_CHARS,
  AGENT_RESULT_MAX_SOURCES,
  AgentToolUnavailableError,
  type AgentCard,
  type AgentEntity,
  type AgentProposeTool,
  type AgentSource,
  type AgentTool,
  type AgentToolContext,
} from './agent-tool';

/** Model calls in one turn, the one that writes the answer included. */
export const AGENT_MAX_ROUNDS = 6;

/** Tool calls in one turn, across its rounds. */
export const AGENT_MAX_CALLS = 10;

/**
 * How long a turn may keep reading before it must answer. A read still
 * running when it is spent is given up on, and no round after it may call
 * a tool.
 */
export const AGENT_READ_BUDGET_MS = 45_000;

/** What bounds one turn. */
export interface AgentLimits {
  rounds: number;
  calls: number;
  readBudgetMs: number;
}

/**
 * A turn's bounds by how hard the member asked Frapp to work (`AskEffort`).
 * "Think harder" is the same loop with more room: more rounds, more reads
 * and longer to read them, and the model's own effort raised by the gateway
 * (`AiAgentPrompt.more`). Each round is still admitted against the member's
 * and the chapter's caps on its own, so more room is never more than they
 * may spend. Both sets fit a trace (`ASK_TRACE_MAX_STEPS`).
 */
export const AGENT_LIMITS: Record<AskEffort, AgentLimits> = {
  default: {
    rounds: AGENT_MAX_ROUNDS,
    calls: AGENT_MAX_CALLS,
    readBudgetMs: AGENT_READ_BUDGET_MS,
  },
  more: { rounds: 10, calls: 16, readBudgetMs: 75_000 },
};

/** A read started with less than this left of the budget still gets it. */
const AGENT_READ_MIN_MS = 2_000;

/** What a read that outlived the budget is given up with. */
class ReadTimedOut extends Error {}

export interface AgentLoopInput {
  task: AiAgentTaskName;
  promptVersion: string;
  /** Operator text only, and the same bytes every round. */
  system: string;
  /** The conversation, ending with the question. */
  messages: LanguageModelMessage[];
  /** Read beside the question, never quoted: who is asking, where from. */
  context: LanguageModelSource[];
  /**
   * The tools this member may use, already checked for them: reads, and for
   * a member who may have Frapp act, from a client that draws cards, the
   * cards it may propose.
   */
  tools: readonly AgentTool[];
  /**
   * The most cards this turn may come with. Left out:
   * `ASK_PROPOSALS_MAX`. One for a client that draws a card only in place
   * of an answer.
   */
  maxCards?: number;
  toolContext: AgentToolContext;
  call: AiCallContext;
  /** What the model reads as a source's name. */
  titleOf: (source: AgentSource) => string;
  signal?: AbortSignal;
  /** {@link AGENT_LIMITS}. Left out: `default`. */
  effort?: AskEffort;
  /** The clock, for the read budget. A test passes its own. */
  clock?: () => number;
}

/** One tool call, as the trace keeps it: no argument and no text. */
export interface AgentCallTrace {
  tool: string;
  /** `ok`, or why it was not run. */
  outcome:
    | 'ok'
    | 'unknown_tool'
    | 'bad_arguments'
    | 'failed'
    | 'timed_out'
    | 'foreign_chapter'
    | 'over_limit';
  /** The size of the arguments the model wrote, in bytes. Never the arguments. */
  argBytes: number;
  sources: number;
  chars: number;
  cut: boolean;
  ms: number;
  /** A propose call that left a card waiting for the asker's Confirm. */
  proposed?: boolean;
}

/** One model call and what it asked for. */
export interface AgentRoundTrace {
  /** `refused`: the provider declined the round, and the turn ended there. */
  outcome: 'ok' | 'refused';
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  ms: number;
  calls: AgentCallTrace[];
}

export type AgentStop =
  /** The model wrote its answer. */
  | 'answered'
  /** A limit took the tools away, and it wrote with what it had. */
  | 'round_limit'
  | 'call_limit'
  | 'time_limit'
  /** A round was not made, or the provider declined it. */
  | 'unavailable'
  | 'refused';

export interface AgentLoopOutcome {
  /** The last round: the answer, or why there is none. */
  result: AiAgentRoundResult;
  /** Everything the tools returned this turn, each id once. */
  sources: AgentSource[];
  entities: AgentEntity[];
  leftOutMessages: number;
  /**
   * What the turn's propose calls came to, in the order they were made: a
   * card waiting for Confirm, a choice of event, or what was left unsaid.
   */
  cards: AgentCard[];
  stop: AgentStop;
  rounds: AgentRoundTrace[];
}

/** The stream ends with one `end`, or with nothing when the member left. */
export type AgentLoopEvent =
  /** Words of the round being written. They are the answer unless `discard` follows. */
  | { type: 'text'; delta: string }
  /** The round's words came before a call: they were not the answer. */
  | { type: 'discard' }
  /** A tool is about to run. `propose`: a card is being worked out. */
  | {
      type: 'tool';
      name: string;
      reading: string;
      effect: 'read' | 'propose';
    }
  | { type: 'end'; outcome: AgentLoopOutcome };

interface RanCall {
  result: LanguageModelToolResult;
  sources: AgentSource[];
  entities: AgentEntity[];
  leftOutMessages: number;
  trace: AgentCallTrace;
  /** A propose call's card, when it came to one. */
  card?: AgentCard | null;
}

/**
 * The loop Ask's agent runs in (#4899, `spec/behavior/ai.md` § Ask Frapp).
 *
 * The model is offered read tools and asks for some; this runs them and
 * asks again, until it writes an answer or a limit says it must. Every rule
 * that keeps that safe is here, not in a prompt
 * (`docs/security/ai-prompt-injection.md`):
 *
 * - **Only an offered tool runs.** The caller offers the tools this member
 *   passed the permission and module check for. A name that is not among
 *   them is refused, whatever the model or a planted message says (C2).
 * - **Arguments are parsed, then run as the asker.** A call's arguments go
 *   through the tool's own schema; what fails never reaches the tool. The
 *   chapter and the asker come from `toolContext`, which no argument can
 *   change (C2, C4).
 * - **A result from another chapter is dropped** and reported: a bug in the
 *   tool, never the model's doing (C4).
 * - **Reads, and cards to confirm. Nothing else.** A tool's `effect` is
 *   checked where it runs, not only where it was offered: a `read` reads as
 *   the asker, a `propose` saves a card only the asker can open and changes
 *   nothing (`AgentProposeTool`), and anything else is refused. So what a
 *   turn read may lead it to read more, or to put a card in front of the
 *   asker, who decides (C3, C5 and C8 as changed 2026-11-13). A turn comes
 *   with at most `maxCards`, made one at a time.
 * - **Bounded.** {@link AGENT_MAX_ROUNDS} model calls, {@link AGENT_MAX_CALLS}
 *   tool calls, a size cap on every result, and a read budget that no read
 *   is waited for past. When one is spent the tools are taken away and the
 *   model answers with what it has.
 * - **Every round is metered.** The gateway admits each round against the
 *   caps and records it. A round that is not admitted ends the turn.
 * - **What a tool read is data.** A result goes back as sources and a note
 *   the tool wrote; nothing in it reaches the system text (C1).
 *
 * It keeps no text: the trace it returns holds names, counts and timings.
 */
@Injectable()
export class AgentLoopService {
  private readonly logger = new Logger(AgentLoopService.name);

  constructor(private readonly gateway: AiGatewayService) {}

  async *run(
    input: AgentLoopInput,
  ): AsyncGenerator<AgentLoopEvent, void, void> {
    const clock = input.clock ?? Date.now;
    const limits = AGENT_LIMITS[input.effort ?? 'default'];
    const more = input.effort === 'more';
    const startedAt = clock();
    const offered = new Map(input.tools.map((tool) => [tool.name, tool]));
    const tools = input.tools.map(toModelTool);

    const rounds: LanguageModelAgentRound[] = [];
    const traces: AgentRoundTrace[] = [];
    const sources = new Map<string, AgentSource>();
    const entities = new Map<string, AgentEntity>();
    // Per tool, the most it reported in one call: two calls of one tool can
    // reach the same conversation, and a count cannot be de-duplicated.
    const leftOut = new Map<string, number>();
    const cards: AgentCard[] = [];
    const maxCards = input.maxCards ?? ASK_PROPOSALS_MAX;
    // Cards left waiting so far, counted as each is made.
    let cardsMade = 0;
    // Propose calls run one after another, across rounds, in the order the
    // model made them: each saves a row, and the limit is on how many.
    let proposing: Promise<unknown> = Promise.resolve();
    let callsRun = 0;
    let limit: AgentStop | null = null;

    const outcome = (
      result: AiAgentRoundResult,
      stop: AgentStop,
    ): AgentLoopOutcome => ({
      result,
      sources: [...sources.values()],
      entities: [...entities.values()],
      leftOutMessages: [...leftOut.values()].reduce((sum, n) => sum + n, 0),
      cards,
      stop,
      rounds: traces,
    });

    for (;;) {
      // The last round allowed is one that writes.
      if (limit === null && rounds.length >= limits.rounds - 1) {
        limit = 'round_limit';
      }
      const roundStartedAt = clock();
      let wrote = false;
      let result: AiAgentRoundResult | null = null;
      for await (const event of this.gateway.streamAgentRound(
        input.task,
        {
          promptVersion: input.promptVersion,
          system: input.system,
          messages: input.messages,
          tools,
          context: input.context,
          rounds,
          ...(limit === null ? {} : { mustAnswer: true }),
          ...(more ? { more: true } : {}),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        input.call,
      )) {
        if (event.type === 'text') {
          wrote = true;
          yield { type: 'text', delta: event.delta };
        } else result = event.result;
      }
      // The gateway's stream always ends with its result.
      if (result === null) throw new Error('An agent round had no result');

      if (result.status !== 'ok') {
        // A declined round was still a call to the model. One the gateway
        // would not make was not, and leaves no step.
        if (result.status === 'refused') {
          traces.push({
            outcome: 'refused',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            ms: clock() - roundStartedAt,
            calls: [],
          });
        }
        yield {
          type: 'end',
          outcome: outcome(
            result,
            result.status === 'refused' ? 'refused' : 'unavailable',
          ),
        };
        return;
      }
      const trace: AgentRoundTrace = {
        outcome: 'ok',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        ms: clock() - roundStartedAt,
        calls: [],
      };
      traces.push(trace);

      // A round told to answer has answered, whatever else it tried.
      if (result.toolCalls.length === 0 || limit !== null) {
        yield {
          type: 'end',
          outcome: outcome({ ...result, toolCalls: [] }, limit ?? 'answered'),
        };
        return;
      }

      if (wrote) yield { type: 'discard' };
      const ran: RanCall[] = [];
      // In order, so "the first ten" is the first ten the model asked for,
      // and announced one by one. The reads themselves run together.
      const pending: Promise<RanCall>[] = [];
      for (const call of result.toolCalls) {
        const tool = offered.get(call.name);
        if (callsRun >= limits.calls) {
          pending.push(
            Promise.resolve(
              notRun(call, 'over_limit', 'The limit on reads was reached.'),
            ),
          );
          continue;
        }
        callsRun += 1;
        if (tool) {
          yield {
            type: 'tool',
            name: tool.name,
            reading: tool.reading,
            effect: tool.effect,
          };
        }
        if (tool?.effect === 'propose') {
          const made = proposing.then(async () => {
            const done = await this.runProposal(
              call,
              tool,
              input,
              clock,
              cardsMade >= maxCards,
            );
            if (done.card?.status === 'proposed') cardsMade += 1;
            return done;
          });
          proposing = made.catch(() => undefined);
          pending.push(made);
          continue;
        }
        pending.push(
          this.runCall(
            call,
            tool,
            input,
            clock,
            Math.max(
              limits.readBudgetMs - (clock() - startedAt),
              AGENT_READ_MIN_MS,
            ),
          ),
        );
      }
      try {
        ran.push(...(await Promise.all(pending)));
      } catch (error) {
        if (!(error instanceof AgentToolUnavailableError)) throw error;
        // A read the gateway would not make ends the turn with its reason,
        // as a round it would not make does.
        yield {
          type: 'end',
          outcome: outcome(error.unavailable, 'unavailable'),
        };
        return;
      }
      // Nothing more is read or written for a member who left. No `end`:
      // there is no outcome to hand anyone.
      if (input.signal?.aborted) return;

      for (const call of ran) {
        trace.calls.push(call.trace);
        if (call.card) cards.push(call.card);
        leftOut.set(
          call.trace.tool,
          Math.max(leftOut.get(call.trace.tool) ?? 0, call.leftOutMessages),
        );
        for (const entity of call.entities) {
          entities.set(`${entity.type}:${entity.id}`, entity);
        }
        for (const source of call.sources) {
          if (!sources.has(source.id)) sources.set(source.id, source);
        }
      }
      rounds.push({
        replay: result.replay,
        results: ran.map((call) => ({
          ...call.result,
          // One text per id for the whole turn: a quote is checked against
          // the source by its id, so a second read of the same thing must
          // not put different words under it.
          sources: call.result.sources.map((source) => {
            const first = sources.get(source.id);
            return first
              ? { ...source, text: first.text, title: input.titleOf(first) }
              : source;
          }),
        })),
      });

      if (callsRun >= limits.calls) limit = 'call_limit';
      else if (clock() - startedAt >= limits.readBudgetMs) {
        limit = 'time_limit';
      }
    }
  }

  private async runCall(
    call: LanguageModelToolCall,
    tool: AgentTool | undefined,
    input: AgentLoopInput,
    clock: () => number,
    /** How long this read may take before it is given up on. */
    allowedMs: number,
  ): Promise<RanCall> {
    // Checked where it runs, not only where it was offered.
    if (!tool || tool.effect !== 'read') {
      return notRun(call, 'unknown_tool', 'That tool is not available.');
    }
    const parsed = tool.input.safeParse(call.input ?? {});
    if (!parsed.success) return badArguments(call, tool.name, parsed.error);

    const startedAt = clock();
    try {
      const result = await within(
        allowedMs,
        tool.run(parsed.data, input.toolContext),
      );
      if (result.chapterId !== input.toolContext.chapterId) {
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'ask-agent-tool-foreign-chapter',
          message: `Ask: tool ${tool.name} returned another chapter's data; dropped`,
          tags: { tool: tool.name },
        });
        return notRun(call, 'foreign_chapter', 'The read failed.', tool.name);
      }

      const kept: AgentSource[] = [];
      let chars = 0;
      let cut = result.sources.length > AGENT_RESULT_MAX_SOURCES;
      for (const source of result.sources.slice(0, AGENT_RESULT_MAX_SOURCES)) {
        if (!source.text.trim()) continue;
        if (chars + source.text.length > AGENT_RESULT_MAX_CHARS) {
          cut = true;
          // A first source too long on its own is cut to its leading lines,
          // and that cut text is the source from here on: it is what the
          // model reads and what a quote is checked against. Any later one
          // is whole or absent.
          if (kept.length === 0) {
            const text = leadingLines(source.text, AGENT_RESULT_MAX_CHARS);
            if (text) {
              chars += text.length;
              kept.push({ ...source, text });
            }
          }
          break;
        }
        chars += source.text.length;
        kept.push(source);
      }
      const note = [
        result.note,
        cut
          ? 'There was more than fits here; narrow the read to see it.'
          : null,
        kept.length === 0 && !result.note ? 'Nothing found.' : null,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        result: {
          callId: call.id,
          sources: kept.map((source) => ({
            id: source.id,
            title: input.titleOf(source),
            text: source.text,
          })),
          note: note || null,
        },
        sources: kept,
        entities: result.entities,
        leftOutMessages: result.leftOutMessages,
        trace: {
          tool: tool.name,
          outcome: 'ok',
          argBytes: argBytes(call),
          sources: kept.length,
          chars,
          cut,
          ms: clock() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof LanguageModelError && error.kind === 'aborted') {
        throw error;
      }
      if (error instanceof AgentToolUnavailableError) throw error;
      const timedOut = error instanceof ReadTimedOut;
      this.logger.warn(
        `Ask: tool ${tool.name} failed (${
          error instanceof Error ? error.name : 'unknown'
        }); the turn goes on without it`,
      );
      return {
        ...notRun(
          call,
          timedOut ? 'timed_out' : 'failed',
          timedOut ? 'The read took too long.' : 'The read failed.',
          tool.name,
        ),
        trace: {
          tool: tool.name,
          outcome: timedOut ? 'timed_out' : 'failed',
          argBytes: argBytes(call),
          sources: 0,
          chars: 0,
          cut: false,
          ms: clock() - startedAt,
        },
      };
    }
  }

  /**
   * One propose call. It is not raced against the read budget: a card given
   * up on would still be saved, waiting where the member never sees it. What
   * bounds it is its own work, a roster lookup and at most one small
   * metered call.
   */
  private async runProposal(
    call: LanguageModelToolCall,
    tool: AgentProposeTool,
    input: AgentLoopInput,
    clock: () => number,
    /** The turn already has as many cards as it may come with. */
    full: boolean,
  ): Promise<RanCall> {
    const parsed = tool.input.safeParse(call.input ?? {});
    if (!parsed.success) return badArguments(call, tool.name, parsed.error);
    if (full) {
      return notRun(
        call,
        'over_limit',
        'No more cards can be made for this answer.',
        tool.name,
      );
    }
    // Nothing is saved for a member who has left.
    if (input.signal?.aborted) {
      return notRun(call, 'failed', 'The card was not made.', tool.name);
    }
    const startedAt = clock();
    const trace = (
      outcome: AgentCallTrace['outcome'],
      proposed: boolean,
    ): AgentCallTrace => ({
      tool: tool.name,
      outcome,
      argBytes: argBytes(call),
      sources: 0,
      chars: 0,
      cut: false,
      ms: clock() - startedAt,
      proposed,
    });
    try {
      const made = await tool.propose(parsed.data, input.toolContext);
      if (made.chapterId !== input.toolContext.chapterId) {
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'ask-agent-tool-foreign-chapter',
          message: `Ask: tool ${tool.name} proposed in another chapter; dropped`,
          tags: { tool: tool.name },
        });
        return notRun(
          call,
          'foreign_chapter',
          'The card was not made.',
          tool.name,
        );
      }
      return {
        result: { callId: call.id, sources: [], note: made.note },
        sources: [],
        entities: [],
        leftOutMessages: 0,
        card: made.card,
        trace: trace('ok', made.card?.status === 'proposed'),
      };
    } catch (error) {
      if (error instanceof LanguageModelError && error.kind === 'aborted') {
        throw error;
      }
      if (error instanceof AgentToolUnavailableError) throw error;
      this.logger.warn(
        `Ask: tool ${tool.name} failed (${
          error instanceof Error ? error.name : 'unknown'
        }); the turn goes on without it`,
      );
      return {
        ...notRun(call, 'failed', 'The card was not made.', tool.name),
        trace: trace('failed', false),
      };
    }
  }
}

/**
 * Which fields, and what kind of fault: the schema's own words, and none of
 * what the model sent.
 */
function badArguments(
  call: LanguageModelToolCall,
  tool: string,
  error: z.ZodError,
): RanCall {
  const faults = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.code}`)
    .join('; ');
  return notRun(
    call,
    'bad_arguments',
    `The arguments were not accepted (${faults}).`,
    tool,
  );
}

function notRun(
  call: LanguageModelToolCall,
  outcome: AgentCallTrace['outcome'],
  note: string,
  /** The tool, when it is one that was offered. Never the model's own word. */
  tool = '(not offered)',
): RanCall {
  return {
    result: { callId: call.id, sources: [], note, failed: true },
    sources: [],
    entities: [],
    leftOutMessages: 0,
    trace: {
      tool,
      outcome,
      argBytes: argBytes(call),
      sources: 0,
      chars: 0,
      cut: false,
      ms: 0,
    },
  };
}

function argBytes(call: LanguageModelToolCall): number {
  try {
    return Buffer.byteLength(JSON.stringify(call.input ?? null), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * `read`, or a rejection once `ms` have passed. The read itself is not
 * stopped, only no longer waited for, and what it settles with is dropped.
 */
async function within<T>(ms: number, read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ReadTimedOut()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // A read given up on may still reject, with nobody left to hear it.
    read.catch(() => undefined);
  }
}

/** The whole lines of `text` that fit in `max` characters. */
function leadingLines(text: string, max: number): string {
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('\n');
  return end > 0 ? cut.slice(0, end) : '';
}

/** A tool as the model is shown it. Throws for a schema that is not an object. */
function toModelTool(tool: AgentTool): LanguageModelTool {
  const schema = z.toJSONSchema(tool.input) as Record<string, unknown>;
  if (schema.type !== 'object') {
    throw new Error(`Agent tool ${tool.name} must take an object`);
  }
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
  };
}
