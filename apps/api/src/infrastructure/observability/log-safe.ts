/** Longest a single caller-supplied value may occupy in one log record. */
const MAX_LOG_VALUE_LENGTH = 200;

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
 * A caller-supplied string made safe to interpolate into a log message.
 *
 * The application log stream is one record per line, so a value carrying a
 * newline lets whoever supplied it forge a whole record — a fabricated
 * `security_event` in the same stream the auth-failure spike detector and any
 * incident investigation read. Query-string values on public callback routes
 * are the realistic source: `GET /v1/discord/connect/callback` is
 * unauthenticated by necessity, so `error` and `error_description` are chosen
 * by whoever follows the link, not by Discord.
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
  if (typeof value !== 'string' || value.length === 0) return '';
  const stripped = value.replace(CONTROL_CHARS, '');
  return stripped.length > MAX_LOG_VALUE_LENGTH
    ? `${stripped.slice(0, MAX_LOG_VALUE_LENGTH)}\u2026`
    : stripped;
}
