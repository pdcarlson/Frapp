import type { z } from 'zod';
import type { AskSourceKind, AskSourceTarget } from '@repo/validation';
import type { AiUnavailable } from '../../ai/ai-gateway.service';
import type { AgentToolSpec } from '../ask-tool';

/**
 * The contract between Ask's agent loop and the tools it can call (epic
 * #4898, `spec/behavior/ai.md` § Ask Frapp). Paul approved the loop and the
 * rule changes it needs on 2026-11-13; this file is the shape every tool is
 * written against, so the tools and the loop can be built side by side.
 * `AgentLoopService` runs them, for a server with `ASK_AGENT=on`.
 *
 * What differs from `AskTool` (`../ask-tool.ts`), the no-argument read the
 * one-shot pipeline runs:
 *
 * - **A tool takes arguments the model wrote.** `input` is their schema. The
 *   loop parses the model's arguments with it before `run` is called, and a
 *   tool never sees arguments that failed it. An argument can narrow a read
 *   (a channel, a name, a date range). It can never widen one: the chapter
 *   and the asker come from {@link AgentToolContext}, never from `args`, and
 *   an id in `args` is checked against what the asker can open like an id in
 *   a URL (`docs/security/ai-prompt-injection.md` C2, C4).
 * - **A result is a list of sources.** The loop hands each one to the model
 *   as a citable block, and a claim in the answer is checked word for word
 *   against the source it cites (C6). So a source's `text` is plain, one
 *   fact per line where it is live data, and a tool that found nothing
 *   returns no sources and says so in `note`. A result's sources go to the
 *   model most useful first: the loop keeps whole sources until the size
 *   cap, and cuts only a first source that is over it on its own.
 * - **Left-out chat is a count per tool.** Two calls of one tool can reach
 *   the same conversation, so the loop takes the largest count a tool
 *   reported in a turn, and adds the tools' counts together.
 * - **A result names the people and channels in it.** `entities` lets the
 *   answer show `@Jordan Lee` and `#general` as links without the model
 *   writing an id.
 *
 * What does not change: a tool names the permission and module of the route
 * it mirrors and is offered only to a member who passes both
 * (`toolsMemberMayUse`); it reads through the same application service the
 * route calls; it says which chapter it read; no contact detail (email,
 * phone, address) is ever in a result; and chat is read only from members
 * who said yes, never from a direct message.
 */
export interface AgentToolContext {
  /** From `ChapterGuard`, never from a model or the request body. */
  chapterId: string;
  /** The asker, from the auth guard. */
  userId: string;
  now: Date;
  /** The asker's IANA time zone, for writing times the way they read them. */
  timeZone: string;
  /** The asker's effective permissions, resolved once for the turn. */
  permissions: ReadonlySet<string>;
  /** The chapter's module switches, as `ChapterGuard` read them. */
  enabledModules: Record<string, boolean> | null;
  signal?: AbortSignal;
}

/** One thing a tool read, as the model reads it and as a citation shows it. */
export interface AgentSource {
  /**
   * Stable for the same thing across calls in one turn, so two tools that
   * read the same message or document yield one source:
   * `message:<id>`, `document:<id>:<chunk>`, `meeting:<id>`, `task:<id>`,
   * `event:<id>`, or `tool:<name>` for a list with no single record.
   */
  id: string;
  kind: AskSourceKind;
  /** What the member sees on the source chip: "#general", "Roster". */
  title: string;
  /** The section, page or author, when it has one. */
  detail: string | null;
  /** ISO time of the thing itself, or null for live data read just now. */
  date: string | null;
  /** Where a tap on the chip opens. */
  target: AskSourceTarget | null;
  /** What the model reads. Member-written text is on one line each. */
  text: string;
  /** True for channel messages, which the answer labels as chat. */
  chat: boolean;
  /** Chat: whose words are in it. Empty for every other source. */
  authorIds: readonly string[];
}

/** A member or channel a result mentions, by the name the result uses. */
export interface AgentEntity {
  type: 'member' | 'channel';
  id: string;
  /** Exactly as it appears in a source's `text`. */
  name: string;
}

export interface AgentToolResult {
  /** The chapter the rows were read from. The loop drops any other. */
  chapterId: string;
  sources: AgentSource[];
  entities: AgentEntity[];
  /**
   * A line for the model that is not a source and cannot be cited: "No open
   * tasks.", "Showing the newest 50 of 212 messages.". Written by the tool,
   * never copied from member text.
   */
  note: string | null;
  /** Channel messages left out because their authors said no. A count. */
  leftOutMessages: number;
}

/** A read the model can call with arguments. It changes nothing. */
export interface AgentReadTool<Args = unknown> extends AgentToolSpec {
  readonly effect: 'read';
  /**
   * The arguments' schema. Keep it flat and small: strings, numbers, enums
   * and ISO dates, every field described, nothing required that has a
   * sensible default. The loop turns it into the JSON schema the model sees.
   */
  readonly input: z.ZodType<Args>;
  /** The line under a working turn while this runs: "Searching messages". */
  readonly reading: string;
  run(args: Args, context: AgentToolContext): Promise<AgentToolResult>;
}

/**
 * Thrown by a tool whose read went through the AI gateway and was not made:
 * the chapter or the member is past a cap, AI is off, or no provider is set
 * up. The loop ends the turn with that reason, as a refused model call
 * would, so the member is told why and not that nothing was found. For
 * nothing else: a read that failed some other way throws an ordinary error
 * and the turn goes on without it.
 */
export class AgentToolUnavailableError extends Error {
  constructor(readonly unavailable: AiUnavailable) {
    super('An agent tool could not read: AI is not available');
    this.name = 'AgentToolUnavailableError';
  }
}

/** The most text one result may hand the model; the loop cuts past it. */
export const AGENT_RESULT_MAX_CHARS = 12_000;

/** The most sources one result may carry. */
export const AGENT_RESULT_MAX_SOURCES = 20;

/** Injection token for the read tools the agent loop may offer. */
export const AGENT_READ_TOOLS = 'AGENT_READ_TOOLS';
