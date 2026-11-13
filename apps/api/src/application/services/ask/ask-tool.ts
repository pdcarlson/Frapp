import {
  isModuleEnabled,
  type AskSourceKind,
  type AskSourcePage,
} from '@repo/validation';
import { WILDCARD } from '#domain/constants/permissions';

/**
 * A live read Ask can make while answering (`spec/behavior/ai.md` § Live
 * structured data): the roster, events, points, dues, the asker's tasks.
 * These are never in the index; a tool reads them at the moment of the
 * question, as the asker.
 *
 * How a tool is kept inside the asker's own access
 * (`docs/security/ai-prompt-injection.md` C2, C3, C5):
 *
 * - **It names the permission and module of the route it mirrors,** and
 *   `AskService` checks both for the asker before the tool is even offered to
 *   the planning call, and runs only a tool it offered. A tool the asker may not use
 *   does not exist for that question.
 * - **It reads through the same application service the route calls,** with
 *   the chapter and the user from the request's guards. A tool never takes a
 *   chapter, a user or any other argument from a model.
 * - **`effect` is `read` for every tool Ask runs.** The acting agent (#718,
 *   `../act/act-tool.ts`) has `propose` tools, whose result is a saved
 *   proposal a person accepts (`ai.md` § Suggestions). Ask's loop refuses
 *   to run anything but `read`, so a question can never change anything.
 * - **Its result says which chapter it read,** and Ask drops a result whose
 *   chapter is not the request's.
 *
 * A result is plain text, one fact per line, because the answer's citations
 * are checked word for word against it like any other source. No contact
 * details (email, phone, address) are ever in a result.
 */
export interface AskToolContext {
  /** From `ChapterGuard`, never from a model or the request body. */
  chapterId: string;
  /** The asker, from the auth guard. */
  userId: string;
  now: Date;
  /** The asker's IANA time zone, for writing times the way they read them. */
  timeZone: string;
}

export interface AskToolResult {
  /** The chapter the rows were read from. */
  chapterId: string;
  /** One fact per line. */
  text: string;
  /**
   * For a tool whose `reach` is `events`: the ids of the listed events that
   * leave some member out (`eventLimitsAudience`). Ids only, for the check
   * made when an answer is posted to a channel (#4713).
   */
  limitedEventIds?: string[];
}

/**
 * Who else could read what a tool returned, which decides whether an answer
 * built on it can go to a channel without a warning (#4713,
 * `spec/behavior/ai.md` § Posting an answer to the channel):
 *
 * - `chapter`: the same for every member who holds the tool's permission
 *   (the roster, the standings).
 * - `asker`: the asker's own records (their points, dues, tasks). Nobody
 *   else can open them, so it always warns.
 * - `events`: the calendar as the asker sees it. Open to all unless it
 *   listed an event that leaves someone in the channel out.
 */
type AskToolReach = 'chapter' | 'asker' | 'events';

export type AskToolEffect = 'read' | 'propose';

/**
 * What every tool a model can name declares, whether it reads (Ask) or
 * proposes a change (the acting agent, `../act/act-tool.ts`). One shape, so
 * one rule decides what a member is offered: {@link toolsMemberMayUse}.
 */
export interface AgentToolSpec {
  /** What the planning call names. `snake_case`. */
  readonly name: string;
  /** One sentence for the planning call: when this tool fits. */
  readonly description: string;
  /** The permission the mirrored route requires of its caller. */
  readonly permission: string;
  /** The module the mirrored route belongs to, or null for an always-on one. */
  readonly module: string | null;
  readonly effect: AskToolEffect;
}

export interface AskTool extends AgentToolSpec {
  /** What a citation of the result is called and where it opens. */
  readonly kind: AskSourceKind;
  readonly title: string;
  readonly page: AskSourcePage;
  readonly reach: AskToolReach;
  /** The read. Null when there is nothing to say (no events, no invoices). */
  run(context: AskToolContext): Promise<AskToolResult | null>;
}

/**
 * Of `tools`, the ones this member may be offered: the mirrored route's
 * permission held (or the wildcard) and its module on. A tool that fails
 * either is never shown to a model, so for that member it does not exist
 * (`docs/security/ai-prompt-injection.md` C2).
 */
export function toolsMemberMayUse<T extends AgentToolSpec>(
  tools: readonly T[],
  heldPermissions: ReadonlySet<string>,
  enabledModules: Record<string, boolean> | null,
): T[] {
  return tools.filter(
    (tool) =>
      (heldPermissions.has(WILDCARD) || heldPermissions.has(tool.permission)) &&
      (tool.module === null || isModuleEnabled(enabledModules, tool.module)),
  );
}

/** Injection token for the list of tools Ask may offer. */
export const ASK_TOOLS = 'ASK_TOOLS';

/** At most this many tools run for one question. */
export const ASK_MAX_TOOLS_PER_QUESTION = 3;
