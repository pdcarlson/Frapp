/**
 * One definition of "a timestamp this API accepts", shared by the DTO that
 * validates it and the service that compares it.
 *
 * The rule: **an ISO 8601 date-time with an explicit UTC offset**, nothing
 * looser. That is narrower than `@IsISO8601()` on purpose, because three
 * shapes it accepts are all wrong against a `timestamptz` column:
 *
 *  - **A bare date.** `2026-01-31` reaches Postgres as midnight, so an
 *    "inclusive upper bound" silently excludes everything that happened that
 *    day. Requiring a time forces the caller to say which instant they mean
 *    rather than having the server guess end-of-day for them.
 *  - **An offset-less time.** `2026-01-31T12:00:00` is resolved by JS in the
 *    Node process's zone and by Postgres in the session's zone. On any
 *    non-UTC runtime the two disagree, so a bound compares as one instant and
 *    filters as another.
 *  - **A form JS cannot parse.** Ordinal (`2026-045`), week (`2026-W05-3`),
 *    basic (`20260101T120000Z`) and hour-only offsets (`+05`) are all legal
 *    ISO 8601 and all `Invalid Date`. Accepted at the boundary and dropped
 *    downstream, they widen the result set behind a `200` — the worst
 *    failure available, because the caller cannot tell.
 *
 * Calendar validity is checked here too: `2026-02-30` passes a regex and
 * passes non-strict `@IsISO8601()`, and JS rolls it forward to March 2 rather
 * than rejecting it, so without this the string reaches Postgres and raises
 * `22008 date/time field value out of range` — a 500 on what is a 400.
 */
export const ISO_INSTANT_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,6})?)?(Z|[+-]\\d{2}:\\d{2})$';

export const ISO_INSTANT_REGEX = new RegExp(ISO_INSTANT_PATTERN);

/** Human-readable form of the rule, for validation messages. */
export const ISO_INSTANT_MESSAGE =
  'must be an ISO 8601 timestamp with an explicit UTC offset, e.g. 2026-01-31T23:59:59.999Z';

const CAPTURE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Epoch milliseconds for a value matching {@link ISO_INSTANT_REGEX}, or `null`
 * when the value is malformed or names a day that does not exist.
 *
 * Deliberately does NOT go through `new Date(string)`. That parser's handling
 * of ISO 8601 is implementation-defined at the edges, is sensitive to the
 * process time zone for offset-less input, and rolls impossible days forward
 * instead of failing. Everything here is arithmetic on the captured fields, so
 * the result depends only on the input.
 *
 * Note this is for COMPARING two bounds. The value handed to Postgres is
 * always the caller's original string — re-serializing it would truncate a
 * `timestamptz`'s microseconds to milliseconds and drop same-millisecond rows.
 */
export function parseIsoInstant(value: string): number | null {
  const m = CAPTURE.exec(value);
  if (!m) return null;

  const [year, month, day, hour, minute] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ];
  const second = m[6] === undefined ? 0 : Number(m[6]);
  // Fractional seconds are left-aligned: `.5` is 500ms, not 5ms.
  const millisecond =
    m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0').slice(0, 3));

  if (hour > 23 || minute > 59 || second > 59) return null;

  // Calendar check, independent of any offset: the day either exists or it
  // does not. `Date.UTC` normalizes an impossible day forward, so comparing
  // the components back is what rejects 2026-02-30 rather than accepting a
  // silent 2026-03-02.
  const utcDay = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDay.getUTCFullYear() !== year ||
    utcDay.getUTCMonth() !== month - 1 ||
    utcDay.getUTCDate() !== day
  ) {
    return null;
  }

  const offsetMinutes =
    m[8] === 'Z'
      ? 0
      : (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
  if (Math.abs(offsetMinutes) > 14 * 60) return null;

  return (
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
    offsetMinutes * 60_000
  );
}
