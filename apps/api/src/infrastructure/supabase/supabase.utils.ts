export function escapeFilterValue(value: string): string {
  // PostgREST string quoting: surround with double quotes and escape internal
  // backslashes and double quotes.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Escapes a user-supplied string for use inside a `like`/`ilike` pattern.
 *
 * `%` and `_` are wildcards to Postgres, so an unescaped search for `50%`
 * matches every row and `a_c` matches `abc`. Backslash is Postgres's default
 * LIKE escape character, so it has to be escaped first or it would escape the
 * wrong thing.
 *
 * This is orthogonal to {@link escapeFilterValue}, which handles PostgREST's
 * own quoting for `.or()` filter strings — a value can need both.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
