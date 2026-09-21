/**
 * The parse behind every "render this timestamp, or render nothing".
 *
 * `new Date(value)` never throws: an unreadable string yields an `Invalid
 * Date`, whose `getTime()` is `NaN` and which formats on screen as the literal
 * string "Invalid Date". Every surface that renders a server timestamp
 * therefore needs the same three lines — construct, test `getTime()`, treat the
 * failure as a non-value — and this is where they live, so a screen reads the
 * decision rather than restating it.
 *
 * The guard is `unknown` rather than `string` because the widest call sites
 * read an unnarrowed JSON field — a number, a `Date`, or `null` reaching one
 * is a non-value here, where `new Date` would have accepted all three
 * (`new Date(null)` is the Unix epoch, not an `Invalid Date`). That rejection
 * is the one part of this guard with observable behaviour, and
 * `instant.spec.ts` pins it.
 *
 * The `""` clause is not: `new Date("")` is already an `Invalid Date`, so the
 * clause only skips constructing one. It is carried over verbatim from the
 * helper this replaced rather than claimed as a behaviour.
 *
 * This is the primitive, not a formatter. `locale.ts` and `bare-date.ts` both
 * parse through it, and the distinction their docs protect is *which string
 * they hand it*, never how the result is guarded — a bare `YYYY-MM-DD` column
 * still goes to `parseBareDateUtcNoon`, which reads it at UTC noon; handing one
 * straight to this function is the UTC-midnight bug that file exists to prevent.
 */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
