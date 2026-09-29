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
 * Chat clock: `"Aug 16, 5:09 PM"` (locale-dependent), or `""` when missing.
 *
 * Empty string, not `"—"`, because the chat meta line concatenates this
 * next to a name and a missing timestamp should not paint an em dash.
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
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * {@link formatTimeOfDay} without the day period: `"5:09"`, or `""` when
 * missing. A grouped chat row's hover time, which sits in the 32px avatar
 * gutter; the run's author line above it already says AM or PM. A 24-hour
 * locale has no day period, so this reads the same as the full form there.
 */
export function formatTimeOfDayShort(value: unknown): string {
  const parsed = parseInstant(value);
  if (!parsed) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .formatToParts(parsed)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}
