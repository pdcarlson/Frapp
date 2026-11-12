/**
 * One background AI job (#4310, ADR-28 decision 10): a row of `ai_runs`.
 *
 * Every background AI feature (drafting minutes, transcribing a recording,
 * indexing a document, the later proactive features) is a run of some `kind`,
 * claimed by `AiRunWorkerService` with a lease. The row holds ids and counts
 * only: `input_ref` and `result_ref` are {@link AiRunRef}s, which the database
 * checks (`ai_run_ref_is_ids_only`), so no prompt, answer or member text is
 * ever stored on a run.
 */
export const AI_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

/** A run in one of these will never be claimed again. */
export const AI_RUN_FINISHED_STATUSES: readonly AiRunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
];

/**
 * Why a run ended as `failed`. The database holds the same list (the
 * `failure_reason` check in `20261112020000_ai_runs.sql`), and
 * `AI_RUN_FAILURE_MESSAGES` says each one in plain words.
 */
export const AI_RUN_FAILURE_REASONS = [
  /** No handler is registered for the run's kind on this server. */
  'unknown_kind',
  /** AI is switched off on the server, or for the chapter. */
  'ai_unavailable',
  /** The member it acts for left the chapter, said no, or lost access. */
  'not_permitted',
  /** What it was working from was deleted. */
  'source_gone',
  /** The chapter reached its AI limit for the period. */
  'spend_limit',
  /** The handler returned a result that is not ids and counts. */
  'invalid_result',
  /** The handler gave up for a reason none of the above names. */
  'handler_failed',
  /** Every try failed or never finished. */
  'attempts_exhausted',
] as const;
export type AiRunFailureReason = (typeof AI_RUN_FAILURE_REASONS)[number];

/** A value an {@link AiRunRef} may hold: an id, a count, a flag, or a list of them. */
export type AiRunRefScalar = string | number | boolean | null;
export type AiRunRefValue = AiRunRefScalar | AiRunRefScalar[];

/**
 * What a run works from or produced, by reference: `{ meeting_id: '<uuid>' }`,
 * `{ draft_id: '<uuid>', suggestion_count: 4 }`. Strings must be uuids
 * (`isAiRunRef`).
 */
export type AiRunRef = { [key: string]: AiRunRefValue };

export interface AiRun {
  id: string;
  chapter_id: string;
  kind: string;
  dedupe_key: string;
  status: AiRunStatus;
  /** `users.id` of the member who asked for it; null when the system did. */
  requested_by: string | null;
  /**
   * `users.id` of the member the run reads as (`spec/behavior/ai.md` § Whose
   * access an AI run uses). Null: it acts for no one, so it may not read the
   * corpus.
   */
  acting_user_id: string | null;
  input_ref: AiRunRef;
  result_ref: AiRunRef | null;
  /** Claims so far, the one in progress included. */
  attempt_count: number;
  max_attempts: number;
  /** Set exactly when `status` is `failed`. */
  failure_reason: AiRunFailureReason | null;
  lock_token: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}
