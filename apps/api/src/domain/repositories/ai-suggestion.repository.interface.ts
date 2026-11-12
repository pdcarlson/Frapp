import type {
  AiSuggestion,
  AiSuggestionKind,
  AiSuggestionSourceType,
} from '../entities/ai-suggestion.entity';

export const AI_SUGGESTION_REPOSITORY = 'AI_SUGGESTION_REPOSITORY';

/** A row to write, before the database fills its id, status and times. */
export type NewAiSuggestion = Pick<
  AiSuggestion,
  | 'batch_id'
  | 'ordinal'
  | 'run_id'
  | 'requested_for'
  | 'kind'
  | 'source_type'
  | 'source_id'
  | 'payload'
  | 'quote'
  | 'quote_author_id'
  | 'required_permission'
  | 'expires_at'
>;

export interface ListPendingAiSuggestionsQuery {
  /**
   * Only rows whose `required_permission` is one of these. `null` means no
   * filter, for a caller who holds the wildcard.
   */
  permissions: readonly string[] | null;
  source?: { type: AiSuggestionSourceType; id: string };
  /** Rows that have not expired at this instant. */
  now: string;
  limit: number;
}

export interface AiSuggestionDecision {
  status: 'accepted' | 'dismissed';
  decidedBy: string;
  edited: boolean;
  now: string;
}

/**
 * `ai_suggestions` (#4309). Chapter-first on every read and write a member
 * reaches. `expireDue` alone crosses chapters, for the hourly sweep.
 */
export interface IAiSuggestionRepository {
  /**
   * Writes a batch. Idempotent on `(batch_id, ordinal)`: a row already written
   * is left alone and not returned, so a retried run writes and notifies
   * nothing twice. Returns the rows this call wrote.
   */
  insertBatch(
    chapterId: string,
    rows: readonly NewAiSuggestion[],
  ): Promise<AiSuggestion[]>;

  findById(chapterId: string, id: string): Promise<AiSuggestion | null>;

  /** Waiting suggestions, newest first, filtered as the query says. */
  listPending(
    chapterId: string,
    query: ListPendingAiSuggestionsQuery,
  ): Promise<AiSuggestion[]>;

  /**
   * Decides a waiting, unexpired suggestion, and empties its text in the same
   * write. Null when it was not waiting any more (someone else decided it, or
   * it expired): the caller re-reads to say which.
   */
  claim(
    chapterId: string,
    id: string,
    decision: AiSuggestionDecision,
  ): Promise<AiSuggestion | null>;

  /**
   * Puts back an acceptance whose commit failed: waiting again, with its text.
   * Only while it has no result, so a committed acceptance is never undone.
   */
  release(
    chapterId: string,
    id: string,
    original: Pick<AiSuggestion, 'payload' | 'quote' | 'quote_author_id'>,
  ): Promise<void>;

  /** Records what accepting made. */
  setResult(chapterId: string, id: string, resultId: string): Promise<void>;

  /**
   * Expires every waiting suggestion whose time is up, in every chapter, and
   * empties its text. Returns one entry per row expired.
   */
  expireDue(
    now: string,
  ): Promise<{ chapter_id: string; kind: AiSuggestionKind }[]>;
}
