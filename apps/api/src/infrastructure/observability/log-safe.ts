/** Longest a single caller-supplied value may occupy in one log record. */
const MAX_LOG_VALUE_LENGTH = 200;

/** How far `render` will descend into a nested value before giving up. */
const MAX_RENDER_DEPTH = 4;

/**
 * C0 and C1 control characters, newline and carriage return among them.
 *
 * `no-control-regex` is disabled deliberately and narrowly: the rule exists to
 * catch control characters written into a pattern by accident, and matching
 * them is this function's entire purpose.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * A value of unknown runtime shape, rendered for a log message.
 *
 * Call sites are typed `string`, but Express's query parser yields an **array**
 * for a repeated key, so `?error=a&error=b` arrives as `['a', 'b']`. Returning
 * `''` for that would erase the very diagnostic the line exists for — an
 * operator investigating a spike of failed connects would read a message with
 * nothing after the colon — so arrays are joined, matching what bare
 * interpolation produced before `logSafe` existed. Stripping and the length cap
 * still apply on the way out, so nothing here is trusted.
 *
 * Objects are not expanded. Express 5's default `query parser` is `simple`
 * (Node's `querystring`), so `?error[x]=1` arrives as the flat key
 * `'error[x]'` and never reaches here from a query string — this branch exists
 * for the `unknown` contract, not for a shape `qs` would build. A placeholder
 * loses nothing that was ever diagnostic, where a JSON dump would carry nested
 * caller-controlled text into the record.
 *
 * Depth-guarded because it recurses. A sanitizer taking `unknown` must not be
 * the thing that throws: a cyclic array (`a.push(a)`) or a deeply nested one
 * would otherwise raise `RangeError` from inside a log statement, in a `catch`
 * block, which is the worst possible place to fail.
 */
function render(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (depth >= MAX_RENDER_DEPTH) return '[nested]';
    return value.map((item) => render(item, depth + 1)).join(',');
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '[object]';
}

/**
 * A caller-supplied string made safe to interpolate into a log message.
 *
 * A log record is one line, so a value carrying a newline lets whoever supplied
 * it write an additional line of their own choosing into the stream an
 * incident investigation reads. Query-string values on public callback routes
 * are the realistic source: `GET /v1/discord/connect/callback` is
 * unauthenticated by necessity, so `error` and `error_description` are chosen
 * by whoever follows the link, not by Discord.
 *
 * A forged line is not perfectly disguised: Nest's default logger prefixes
 * genuine records with `[Nest] <pid> - <ts> <LEVEL>`, which a caller cannot
 * supply. Do not lean on anything past that. A record is **not** one line in
 * general — `logger.error(message, stack)` prints the message and then the
 * stack across further lines — and this subsystem logs at `log`, `warn` and
 * `error`, so neither line count nor level separates forged from genuine.
 * That bounds the damage; it does not make an arbitrarily-writable log stream
 * acceptable.
 *
 * Strips control characters rather than escaping them: these fields are
 * human-readable diagnostics, so a lost control character costs nothing, while
 * an escape scheme has to be un-escaped correctly by every future reader to be
 * worth anything.
 *
 * Also length-capped. An uncapped value lets one request push an arbitrary
 * volume into the log stream, which is both a cost and a way to bury the
 * records either side of it.
 */
export function logSafe(value: unknown): string {
  const text = render(value);
  if (text.length === 0) return '';
  const stripped = text.replace(CONTROL_CHARS, '');
  return stripped.length > MAX_LOG_VALUE_LENGTH
    ? `${stripped.slice(0, MAX_LOG_VALUE_LENGTH)}\u2026`
    : stripped;
}
