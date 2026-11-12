import type { AskSourceKind, AskSourcePage } from '@repo/validation';

/**
 * A live read Ask can make while answering (`spec/behavior/ai.md` § Live
 * structured data): the roster, events, points, dues. These are never in the
 * index; a tool reads them at the moment of the question, as the asker.
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
 * - **`effect` is `read` for every tool Ask runs.** The acting agent (#718)
 *   adds `propose` tools, whose result is a saved proposal a person accepts
 *   (`ai.md` § Suggestions). Ask's loop refuses to run anything but `read`,
 *   so a question can never change anything.
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
}

export type AskToolEffect = 'read' | 'propose';

export interface AskTool {
  /** What the planning call names. `snake_case`. */
  readonly name: string;
  /** One sentence for the planning call: when this tool answers a question. */
  readonly description: string;
  /** What a citation of the result is called and where it opens. */
  readonly kind: AskSourceKind;
  readonly title: string;
  readonly page: AskSourcePage;
  /** The permission the mirrored route requires of its caller. */
  readonly permission: string;
  /** The module the mirrored route belongs to, or null for an always-on one. */
  readonly module: string | null;
  readonly effect: AskToolEffect;
  /** The read. Null when there is nothing to say (no events, no invoices). */
  run(context: AskToolContext): Promise<AskToolResult | null>;
}

/** Injection token for the list of tools Ask may offer. */
export const ASK_TOOLS = 'ASK_TOOLS';

/** At most this many tools run for one question. */
export const ASK_MAX_TOOLS_PER_QUESTION = 3;
