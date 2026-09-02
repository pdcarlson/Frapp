/** Shared bounds for list-style query `limit` parameters (points audit, polls list, etc.). */
export const LIST_QUERY_LIMIT_DEFAULT = 50;
export const LIST_QUERY_LIMIT_MIN = 1;
export const LIST_QUERY_LIMIT_MAX = 200;

/**
 * Clamp a caller-supplied `limit` into `[LIST_QUERY_LIMIT_MIN, LIST_QUERY_LIMIT_MAX]`,
 * defaulting to `LIST_QUERY_LIMIT_DEFAULT` when omitted.
 */
export function clampListLimit(limit?: number): number {
  return Math.max(
    LIST_QUERY_LIMIT_MIN,
    Math.min(limit ?? LIST_QUERY_LIMIT_DEFAULT, LIST_QUERY_LIMIT_MAX),
  );
}
