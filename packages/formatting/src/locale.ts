/**
 * Generic locale date / datetime / clock formatters.
 *
 * These are the C1–C3 consolidations: identical `toLocaleString` /
 * `toLocaleDateString` wrappers that differed only in input-guard width.
 * They assume the input is already a parseable instant (ISO timestamp).
 *
 * Do **not** fold the protected clusters into these:
 * - stopwatch padding (`formatPaddedStopwatch` / `formatTimer`)
 * - bare-date timezone parsing (`parseBareDateLocalMidnight` / `parseBareDateUtcNoon`),
 *   and its own formatter `formatBareDate` — which returns the same shape as
 *   {@link formatLocaleDate} (a `string`, `"—"` on failure) and is therefore
 *   the member most likely to be mistaken for a duplicate wrapper. It is not:
 *   it parses a bare `YYYY-MM-DD` at UTC noon where `formatLocaleDate` reads
 *   it as UTC midnight. A `date` column takes `formatBareDate`.
 * - minute-duration rounding (`formatMinutesExact` / `formatMinutesRounded`)
 *
 * Specs in `protected-clusters.spec.ts` fail if a merge attempt uses these
 * generics for those behaviors.
 */

import { parseInstant } from "./instant";

/**
 * Full locale datetime, or `"—"` when the value is missing / unparseable.
 *
 * Widest input guard of the nine web copies this replaced (`unknown`).
 */
export function formatLocaleDateTime(value: unknown): string {
  const parsed = parseInstant(value);
  return parsed ? parsed.toLocaleString() : "—";
}

/**
 * Locale date-only, or `"—"` when the value is missing / unparseable.
 *
 * Uses `new Date(value)` — correct for ISO instants, **wrong** for a bare
 * `YYYY-MM-DD` near a timezone boundary. Use `parseBareDateUtcNoon` or
 * `parseBareDateLocalMidnight` for those.
 */
export function formatLocaleDate(value: unknown): string {
  const parsed = parseInstant(value);
  return parsed ? parsed.toLocaleDateString() : "—";
}

/**
 * A clock with its date: `"Aug 16, 5:09 PM"` (locale-dependent), or `""` when
 * missing. The chat popovers (pins, saved messages, search) and the events
 * calendar use it. The thread's author line does not: the date there lives in
 * the day divider, so it takes {@link formatTimeOfDay}.
 *
 * Empty string, not `"—"`, because callers concatenate this next to a name
 * and a missing timestamp should not paint an em dash.
 */
export function formatClock(value: unknown): string {
  const parsed = parseInstant(value);
  if (!parsed) return "";
  return parsed.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

/**
 * Built once: constructing an `Intl.DateTimeFormat` is the expensive part, and
 * the chat timeline formats a time for every row on every render. Created on
 * first use rather than at import, so a test that sets a locale or time zone
 * before its first call is honoured.
 *
 * {@link formatTimeOfDay} and {@link formatTimeOfDayShort} both read it, and
 * that is the point: a formatter keeps the zone it was built in, so if the
 * device's zone changes mid-session both a run's author line and its gutter
 * times stay in the same (old) zone until a reload, instead of disagreeing.
 */
let clockFormat: Intl.DateTimeFormat | null = null;
function clock(): Intl.DateTimeFormat {
  clockFormat ??= new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return clockFormat;
}
function clockParts(at: Date): Intl.DateTimeFormatPart[] {
  return clock().formatToParts(at);
}

/**
 * Chat's time of day, `"5:09 PM"` (locale-dependent), or `""` when missing.
 *
 * What a run's author line prints, on web and mobile alike. It carries no date
 * on purpose: in the compact chat layout the date lives only in the day
 * divider (`components.md` §11, #2873), and {@link formatClock}'s
 * `"Aug 16, 5:09 PM"` on every author line is exactly what that decision
 * removed.
 */
export function formatTimeOfDay(value: unknown): string {
  const parsed = parseInstant(value);
  if (!parsed) return "";
  // `Intl` separates the day period with a narrow no-break space (U+202F);
  // `Date#toLocaleTimeString`, which this used to call, prints a plain one in
  // V8. Kept plain, so the text members see does not change.
  // `format`, not `formatToParts`: this is the author line on mobile too, and
  // `format` is the part of `Intl.DateTimeFormat` every engine ships.
  return clock().format(parsed).replace(/\u202f/g, " ");
}

function dayPeriodOf(at: Date): string | undefined {
  return clockParts(at).find((part) => part.type === "dayPeriod")?.value;
}

/**
 * {@link formatTimeOfDay} without the day period when `since` is in the same
 * one: `"5:09"`, or `""` when missing. A grouped chat row's hover time, which
 * sits in the 32px avatar gutter under a run whose author line (`since`, the
 * run's first message) already says AM or PM.
 *
 * A run is measured row to row, so it can cross noon: a follow-on at 12:20 PM
 * under an author line reading 11:50 AM keeps its "PM" rather than reading as
 * 12:20 AM. Without `since`, or in a 24-hour locale with no day period, it is
 * the short form.
 */
export function formatTimeOfDayShort(value: unknown, since?: unknown): string {
  const parsed = parseInstant(value);
  if (!parsed) return "";
  const anchor = parseInstant(since);
  if (anchor && dayPeriodOf(anchor) !== dayPeriodOf(parsed)) {
    return formatTimeOfDay(value);
  }
  return clockParts(parsed)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}
