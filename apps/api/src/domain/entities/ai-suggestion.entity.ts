/**
 * An AI suggestion (#4309): a row of `ai_suggestions`. A proposal a person
 * accepts, edits then accepts, or dismisses. It never acts by itself and never
 * grants anything: accepting re-checks the accepter's permission at that
 * moment and commits through the ordinary service for its kind
 * (ADR-28 decision 11, spec/behavior/ai.md § Suggestions).
 */

/**
 * What accepting a suggestion makes. One value per kind handler. `event` is
 * an event added to the calendar by its own form, which the accept records
 * (#3930). `points` (a points change for one or many members) and
 * `new_event` (an event the accept creates) are proposed by the acting
 * agent (#718).
 */
export const AI_SUGGESTION_KINDS = [
  'task',
  'event',
  'points',
  'new_event',
] as const;
export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

/**
 * What a suggestion was drawn from. A source type with no access checker
 * registered is shown to nobody (fail closed). `task` is an earlier task
 * (last year's, #3930).
 *
 * `request` is a member's own request to the acting agent (#718): its
 * `source_id` is that member's user id, and only they can open it.
 */
export const AI_SUGGESTION_SOURCE_TYPES = [
  'meeting',
  'event',
  'channel',
  'task',
  'request',
] as const;
export type AiSuggestionSourceType =
  (typeof AI_SUGGESTION_SOURCE_TYPES)[number];

/**
 * `accepting` is the moment between Accept and the change being made: the row
 * keeps its text, so a failed commit puts it back to `pending` intact.
 */
export const AI_SUGGESTION_STATUSES = [
  'pending',
  'accepting',
  'accepted',
  'dismissed',
  'expired',
] as const;
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];

/** The kind-specific proposal, as the kind handler normalized it. */
export type AiSuggestionPayload = Record<string, unknown>;

export interface AiSuggestion {
  id: string;
  chapter_id: string;
  /** One batch is one push (spec: one notification per batch). */
  batch_id: string;
  /** Position in its batch; `(batch_id, ordinal)` makes a retried write a no-op. */
  ordinal: number;
  /** The AI run that produced it (#4310), when there is one. */
  run_id: string | null;
  /** The member the run acted for. */
  requested_for: string | null;
  kind: AiSuggestionKind;
  source_type: AiSuggestionSourceType;
  source_id: string;
  /** The proposal. Emptied (`{}`) once accepted, dismissed or expired. */
  payload: AiSuggestionPayload;
  /**
   * The words it came from, kept only when they appear word for word in the
   * source. Null when there was none, it failed the check, or it is decided.
   */
  quote: string | null;
  /** Whose words the quote is, when they are a member's. */
  quote_author_id: string | null;
  /** The permission the accepter must hold at the moment they accept. */
  required_permission: string;
  status: AiSuggestionStatus;
  /** Accepted with changes. */
  edited: boolean;
  decided_by: string | null;
  decided_at: string | null;
  /** The id of what accepting made (a task id for a task suggestion). */
  result_id: string | null;
  /**
   * Which thing in its source it was made from (an action item of the
   * minutes), as a fingerprint and never the words, so the same thing is not
   * proposed twice: unique per source and kind, and kept once decided. Null
   * for a proposal with nothing to tell it apart by.
   */
  dedupe_key: string | null;
  /** When its batch push went out; null while it is still owed. */
  notified_at: string | null;
  expires_at: string;
  created_at: string;
}
