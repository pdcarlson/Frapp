import type { AiProvider } from './language-model.interface';

/**
 * Whose call this is. There is always an acting member
 * (`spec/behavior/ai.md` § Whose access an AI run uses): the asker, or the
 * officer a background run acts for. Both ids come from the request's guard
 * or the run's row, never from a request body or a model.
 */
export interface AiCallContext {
  chapterId: string;
  /** The acting member's user id. */
  actingUserId: string;
  /** The AI run this call belongs to, when it is background work. */
  runId?: string;
  /**
   * Upkeep the chapter turned on, not something the acting member asked for:
   * indexing the chapter's sources for Ask (#720). The spend ledger holds it
   * against the chapter's month and the provider's month only, and records
   * it with no member, so a large backfill never spends the acting
   * member's own daily allowance (#4504). Consent is still checked as the
   * acting member.
   */
  chapterUpkeep?: true;
}

/**
 * The chapter switch a task sits behind (`spec/behavior/ai.md` § Consent,
 * gate 1): the president turns each family on separately.
 */
export type AiFeatureFamily = 'meetings' | 'ask' | 'corpus';

/**
 * What the gateway tells each seam about the call it is about to make, or
 * has just made. No prompt, no answer, no source text: a seam decides and
 * records from who, which task and how much, never from content.
 */
export interface AiCallDescriptor extends AiCallContext {
  task: string;
  family: AiFeatureFamily;
  provider: AiProvider;
  model: string;
  /** `<feature>@vN`, from the prompt the caller used. */
  promptVersion: string;
}
