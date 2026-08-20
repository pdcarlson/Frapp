/**
 * Generic locale date / datetime / clock formatters.
 *
 * These are the C1–C3 consolidations: identical `toLocaleString` /
 * `toLocaleDateString` wrappers that differed only in input-guard width.
 * They assume the input is already a parseable instant (ISO timestamp).
 *
 * Do **not** fold the protected clusters into these:
 * - stopwatch padding (`formatPaddedStopwatch` / `formatTimer`)
 * - bare-date timezone parsing (`parseBareDateLocalMidnight` / `parseBareDateUtcNoon`)
 * - minute-duration rounding (`formatMinutesExact` / `formatMinutesRounded`)
 *
 * Specs in `protected-clusters.spec.ts` fail if a merge attempt uses these
 * generics for those behaviors.
 */

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

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
