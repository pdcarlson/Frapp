import type { ActMissing, ActNoteType } from '@repo/validation';
import type { AiSuggestionKind } from '#domain/entities/ai-suggestion.entity';
import type { AgentToolSpec } from '../ask/ask-tool';
import type { ActPlan } from './act-prompt';

/**
 * A change the acting agent can propose (#718, `spec/behavior/ai.md`
 * § Asking Frapp to do something): give points, create a task, create an
 * event. The same registry shape as Ask's live reads (`../ask/ask-tool.ts`),
 * with `effect: 'propose'`.
 *
 * How a tool is kept inside the member's own authority
 * (`docs/security/ai-prompt-injection.md` C2, C3, C4, C5):
 *
 * - **It names the permission and module of the route it mirrors,** and
 *   `ActService` offers it to the planning call only when the member holds
 *   both. A tool the member may not use does not exist for that request, and
 *   a planning call that names one anyway gets nothing.
 * - **It never writes.** `draft` returns a proposal. `ActService` saves it as
 *   an `ai_suggestions` row only that member can open; the change is made
 *   when they confirm, by the suggestion's kind handler, through the same
 *   application service the route calls, after that route's permission is
 *   checked again (`AiSuggestionService.accept`).
 * - **It takes no chapter, user or id from a model.** The chapter and the
 *   member come from the request's guards. A model writes names; the tool
 *   looks them up in this chapter's roster and nowhere else, so another
 *   chapter's member cannot be named into a proposal.
 * - **Anything else it reads, it reads as the member.** Attendance is read
 *   only for a member who holds the attendance route's permission.
 */
export interface ActToolContext {
  /** From `ChapterGuard`, never from a model or the request body. */
  chapterId: string;
  /** The member who asked, from the auth guard. */
  userId: string;
  now: Date;
  /** The member's IANA time zone: "Friday at 7" is their Friday. */
  timeZone: string;
  /** What the member holds now, for a tool's secondary reads. */
  heldPermissions: ReadonlySet<string>;
  enabledModules: Record<string, boolean> | null;
  signal?: AbortSignal;
}

/** Something the card says beside the proposal. Never stored. */
export interface ActNote {
  type: ActNoteType;
  /** The name as the member typed it. */
  name?: string;
  /** The members a name could be, for a picker. */
  user_ids?: string[];
  count?: number;
}

/** An event the member can pick as "the one everyone came to". */
export interface ActEventChoice {
  id: string;
  name: string;
  start_time: string;
}

export type ActDraft =
  | {
      status: 'draft';
      /** The proposal, for its kind's `normalizeProposal`. */
      payload: Record<string, unknown>;
      notes: ActNote[];
    }
  | {
      status: 'needs_event';
      amount: number;
      reason: string;
      events: ActEventChoice[];
    }
  | { status: 'unclear'; missing: ActMissing };

export interface ActTool extends AgentToolSpec {
  readonly effect: 'propose';
  /** The suggestion kind whose handler makes the change on confirm. */
  readonly kind: AiSuggestionKind;
  /**
   * Turns what the planning call understood into a proposal, reading what
   * it needs (the roster, an event's attendance) as the member. Writes
   * nothing.
   */
  draft(plan: ActPlan, context: ActToolContext): Promise<ActDraft>;
}

/** Injection token for the list of changes the agent may propose. */
export const ACT_TOOLS = 'ACT_TOOLS';
