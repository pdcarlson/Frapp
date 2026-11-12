/**
 * An AI suggestion (#4309): a row of `ai_suggestions`. A proposal a person
 * accepts, edits then accepts, or dismisses. It never acts by itself and never
 * grants anything: accepting re-checks the accepter's permission at that
 * moment and commits through the ordinary service for its kind
 * (ADR-28 decision 11, spec/behavior/ai.md § Suggestions).
 */

/** What accepting a suggestion makes. One value per kind handler. */
export const AI_SUGGESTION_KINDS = ['task'] as const;
export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

/**
 * What a suggestion was drawn from. A source type with no access checker
 * registered is shown to nobody (fail closed).
 */
export const AI_SUGGESTION_SOURCE_TYPES = [
  'meeting',
  'event',
  'channel',
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
  /** When its batch push went out; null while it is still owed. */
  notified_at: string | null;
  expires_at: string;
  created_at: string;
}
