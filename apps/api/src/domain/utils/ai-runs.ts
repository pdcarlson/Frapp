import type {
  AiRunFailureReason,
  AiRunRef,
  AiRunRefScalar,
} from '../entities/ai-run.entity';

/**
 * The rules of the AI run queue (#4310) that are not wiring: the server
 * switch, the ids-only rule for a run's references, the retry schedule, and
 * the words a person reads when a run fails.
 */

/**
 * Whether AI runs on this server at all (`AI_ENABLED`, ADR-28). Only the exact
 * strings `"1"` and `"true"` switch it on, as `EXPO_PUBLIC_ASK_ENABLED` does:
 * unset, empty, `"0"`, `"yes"` and `"TRUE"` all leave it off. With it off the
 * worker never queries the table and every AI run route answers "not
 * available", so the API behaves as it did before AI existed.
 *
 * Read on each call, not cached, so a test (or a restart with a new value)
 * changes it without rebuilding anything.
 */
export function isAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AI_ENABLED;
  return value === '1' || value === 'true';
}

/** How long one claim holds a run before another worker may take it over. */
export const AI_RUN_LEASE_MS = 5 * 60_000;

/** How often a worker running a handler pushes its lease forward. */
export const AI_RUN_HEARTBEAT_MS = 60_000;

/** A try that runs longer than this is stopped and counts as a failed try. */
export const AI_RUN_DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** The longest time limit a handler may ask for: one hour. */
export const AI_RUN_MAX_TIMEOUT_MS = 60 * 60_000;

/** Tries per run unless its handler says otherwise. Never more than 10 (the table's check). */
export const AI_RUN_DEFAULT_MAX_ATTEMPTS = 3;
export const AI_RUN_MAX_ATTEMPTS_CEILING = 10;

/** Runs one API process works on at once. */
export const AI_RUN_MAX_CONCURRENT = 4;

/** Finished runs older than this are deleted by the daily prune. */
export const AI_RUN_RETENTION_DAYS = 90;

/**
 * Wait before try `attempt + 1` after try `attempt` failed on something that
 * may clear by itself: 30 seconds, then 2 minutes, then 10 for every later try.
 */
export function aiRunRetryDelayMs(attempt: number): number {
  if (attempt <= 1) return 30_000;
  if (attempt === 2) return 2 * 60_000;
  return 10 * 60_000;
}

export const AI_RUN_KIND = /^[a-z][a-z0-9_]{0,47}$/;
export const AI_RUN_DEDUPE_KEY = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;
const REF_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_REF_KEYS = 32;
const MAX_REF_ARRAY = 500;

function isRefScalar(value: unknown): value is AiRunRefScalar {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Whether `value` may be stored as a run's `input_ref` or `result_ref`: an
 * object of at most 32 snake_case keys whose values are uuids, finite numbers,
 * booleans, nulls, or arrays of at most 500 of those. The same rule as the
 * database's `ai_run_ref_is_ids_only`, checked first here so a feature that
 * tries to store text fails in its own code with a clear error rather than on
 * a constraint.
 */
export function isAiRunRef(value: unknown): value is AiRunRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  // A plain object only: a Date, a Map or a class instance would serialize
  // to something other than what was checked.
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_REF_KEYS) return false;
  return entries.every(([key, item]) => {
    if (!REF_KEY.test(key)) return false;
    if (Array.isArray(item)) {
      return item.length <= MAX_REF_ARRAY && item.every(isRefScalar);
    }
    return isRefScalar(item);
  });
}

/**
 * What a person reads when a run failed. Plain words, no codes; the run's
 * label ("Drafting minutes") comes before it on the screen.
 */
export function aiRunFailureMessage(
  reason: AiRunFailureReason,
  maxAttempts: number,
): string {
  switch (reason) {
    case 'unknown_kind':
      return 'This kind of job is not available right now.';
    case 'ai_unavailable':
      return 'AI features are turned off right now.';
    case 'not_permitted':
      return 'The person this was running for no longer has access to it.';
    case 'source_gone':
      return 'What this was working from was deleted.';
    case 'spend_limit':
      return 'Your chapter reached its AI limit for this period.';
    case 'invalid_result':
    case 'handler_failed':
      return 'Something went wrong. Try again.';
    case 'attempts_exhausted':
      return maxAttempts === 1
        ? 'It stopped because the try did not finish.'
        : `It stopped after ${maxAttempts} tries that did not finish.`;
  }
}
