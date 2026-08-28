/**
 * Protected cluster 2 — bare-date timezone parsing.
 *
 * A `YYYY-MM-DD` string has no time or offset. `new Date(value)` (what
 * {@link formatLocaleDate} uses) reads it as **UTC midnight**, which renders
 * as the previous calendar day west of Greenwich.
 *
 * Two members stay distinct on purpose:
 * - {@link parseBareDateUtcNoon} — `T12:00:00Z`. Stays on the submitted
 *   calendar day in every zone from UTC−12 to UTC+12. Mobile service hours,
 *   invoices, and task due dates.
 * - {@link parseBareDateLocalMidnight} — `T00:00:00` (no Z). Local midnight
 *   so a chat task card matches a server-formatted local day. Web only.
 *
 * Do not fold either into `formatLocaleDate` / `new Date(value)`.
 */

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asDate(isoLocalOrZ: string): Date | null {
  const parsed = new Date(isoLocalOrZ);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `YYYY-MM-DD` at UTC noon, or `null` when the value is not a bare date. */
export function parseBareDateUtcNoon(value: string): Date | null {
  if (!BARE_DATE.test(value)) return null;
  return asDate(`${value}T12:00:00Z`);
}

/** `YYYY-MM-DD` at local midnight, or `null` when the value is not a bare date. */
export function parseBareDateLocalMidnight(value: string): Date | null {
  if (!BARE_DATE.test(value)) return null;
  return asDate(`${value}T00:00:00`);
}

/**
 * Bare `YYYY-MM-DD` at UTC noon; any other parseable instant via `new Date`.
 *
 * A full timestamp already carries its offset — appending `T12:00:00Z` to one
 * yields `NaN`. Callers that accept either shape (task due dates, chat cards)
 * use this rather than forcing the noon parse.
 */
export function parseInstantOrBareUtcNoon(value: string): Date | null {
  return parseBareDateUtcNoon(value) ?? asDate(value);
}
