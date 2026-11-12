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
> & { dedupe_key?: string | null };

export interface ListPendingAiSuggestionsQuery {
  /**
   * Only rows whose `required_permission` is one of these. `null` means no
   * filter, for a caller who holds the wildcard.
   */
  permissions: readonly string[] | null;
  source?: { type: AiSuggestionSourceType; id: string };
  /** Rows that have not expired at this instant. */
  now: string;
  /** Rows to skip, for reading past rows the caller can't see. */
  offset: number;
  limit: number;
}

export interface AiSuggestionClaim {
  /**
   * `accepting` holds the row, text and all, while the change is made;
   * `dismissed` decides it and empties its text in the same write.
   */
  status: 'accepting' | 'dismissed';
  decidedBy: string;
  edited: boolean;
  now: string;
}

/**
 * `ai_suggestions` (#4309). Chapter-first on every read and write a member
 * reaches. `expireDue` and `releaseStale` alone cross chapters, for the
 * hourly sweep.
 */
export interface IAiSuggestionRepository {
  /**
   * Writes a batch. Idempotent on `(batch_id, ordinal)`: a row already written
   * is left alone and not returned. Returns the rows this call wrote. Throws
   * a unique violation (`isUniqueViolation`) when a row's `dedupe_key` is
   * already taken for its source and kind, and then writes none of them.
   */
  insertBatch(
    chapterId: string,
    rows: readonly NewAiSuggestion[],
  ): Promise<AiSuggestion[]>;

  /**
   * Every suggestion of one kind ever made from a source and told apart by a
   * `dedupe_key`, whatever became of it: what a feature reads before it
   * proposes from that source again.
   */
  listKeyedForSource(
    chapterId: string,
    source: { type: AiSuggestionSourceType; id: string },
    kind: AiSuggestionKind,
  ): Promise<AiSuggestion[]>;

  /**
   * Withdraws waiting suggestions: the thing each was made from is gone from
   * its source, or changed. Only rows still `pending` go; one being accepted
   * or already decided stays. Returns how many went.
   */
  deletePending(chapterId: string, ids: readonly string[]): Promise<number>;

  /** A batch's waiting rows whose push has not gone out yet. */
  listUnnotified(chapterId: string, batchId: string): Promise<AiSuggestion[]>;

  /** Records that these rows' batch push went out. */
  markNotified(
    chapterId: string,
    ids: readonly string[],
    now: string,
  ): Promise<void>;

  findById(chapterId: string, id: string): Promise<AiSuggestion | null>;

  /** Waiting suggestions, newest first, filtered as the query says. */
  listPending(
    chapterId: string,
    query: ListPendingAiSuggestionsQuery,
  ): Promise<AiSuggestion[]>;

  /**
   * Takes a waiting, unexpired suggestion. Null when it was not waiting any
   * more (someone else took it, or it expired): the caller re-reads to say
   * which.
   */
  claim(
    chapterId: string,
    id: string,
    claim: AiSuggestionClaim,
  ): Promise<AiSuggestion | null>;

  /**
   * Finishes an accept: `accepting` to `accepted`, with what it made, and
   * empties its text. Null when the row is no longer `accepting` (its source
   * was deleted meanwhile).
   */
  finishAccept(
    chapterId: string,
    id: string,
    resultId: string,
  ): Promise<AiSuggestion | null>;

  /** Puts an accept whose commit failed back to waiting, text intact. */
  release(chapterId: string, id: string): Promise<void>;

  /**
   * Puts back every accept, in every chapter, left `accepting` since before
   * `before`: the API died between Accept and the change. Returns how many.
   */
  releaseStale(before: string): Promise<number>;

  /**
   * Expires every waiting suggestion whose time is up, in every chapter, and
   * empties its text. Returns one entry per row expired.
   */
  expireDue(
    now: string,
  ): Promise<{ chapter_id: string; kind: AiSuggestionKind }[]>;

  /**
   * Takes a person's words out of every suggestion that quotes them, in every
   * chapter: they said No on the AI sheet, which covers every chapter they
   * are in (#4308). The suggestion stays and shows its source without the
   * quote. Returns how many rows changed; running it again changes none.
   */
  dropQuotesBy(userId: string): Promise<number>;
}
