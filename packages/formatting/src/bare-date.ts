/**
 * Protected cluster 2 — bare-date timezone parsing.
 *
 * A `YYYY-MM-DD` string has no time or offset. `new Date(value)` reads it as
 * **UTC midnight**, which renders as the previous calendar day west of
 * Greenwich. That is not one member's quirk: `formatLocaleDate`,
 * `formatLocaleDateTime` and `formatClock` all parse through the single
 * `parseInstant` helper in `instant.ts` — the same one this file uses — so
 * **all three** carry it. A bare
 * `date` column takes {@link formatBareDate}, never any of the three.
 *
 * Two *parsers* stay distinct on purpose — and {@link formatBareDate} at the
 * foot of this file is the cluster's formatter over them:
 * - {@link parseBareDateLocalNoon} — `T12:00:00` (no Z). Local noon, which is
 *   the submitted calendar day in every zone, UTC−12 to UTC+14. Mobile
 *   service hours, invoices, task due dates, and {@link formatBareDate}.
 * - {@link parseBareDateLocalMidnight} — `T00:00:00` (no Z). Local midnight,
 *   for when the *instant* matters, not only the day: the Discord import sends
 *   it as "from this date" (`import-wizard.tsx`), where noon would drop the
 *   morning's messages. Web only (that, and the chat task card).
 *
 * Both now read the same local day, so neither can stand in for the other by
 * that test alone: noon is the one for display, midnight the one for a cutoff.
 *
 * Do not fold either into `formatLocaleDate` / `new Date(value)`.
 *
 * Local, not UTC, because every caller reads the result in the device's zone:
 * `toLocaleDateString`, `dayDelta`'s local Y/M/D, the Dues chip's end of the
 * local day. Until #3026 this parsed at UTC noon (`T12:00:00Z`), which is
 * already the next local day at UTC+12 and east: an invoice due Sep 30 read
 * "Due Oct 1" in Auckland, and "Past due" on Oct 1 itself.
 */

import { parseInstant } from "./instant";

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` at local noon, or `null` when the value is not a bare date. */
export function parseBareDateLocalNoon(value: string): Date | null {
  if (!BARE_DATE.test(value)) return null;
  return parseInstant(`${value}T12:00:00`);
}

/** `YYYY-MM-DD` at local midnight, or `null` when the value is not a bare date. */
export function parseBareDateLocalMidnight(value: string): Date | null {
  if (!BARE_DATE.test(value)) return null;
  return parseInstant(`${value}T00:00:00`);
}

/**
 * Bare `YYYY-MM-DD` at local noon; any other parseable instant via `new Date`.
 *
 * A full timestamp already carries its offset — appending `T12:00:00` to one
 * yields `NaN`. Callers that accept either shape (task due dates, chat cards)
 * use this rather than forcing the noon parse.
 */
export function parseInstantOrBareLocalNoon(value: string): Date | null {
  return parseBareDateLocalNoon(value) ?? parseInstant(value);
}

/**
 * A `date` column rendered as a locale date, or `"—"` when the value is
 * missing or unparseable.
 *
 * This is the cluster's own formatter — the counterpart to
 * {@link formatLocaleDate} for **bare `YYYY-MM-DD`** columns, and the reason
 * the two must not be folded together. `formatLocaleDate` reads that string
 * through `new Date(value)`, which is UTC midnight and so renders the
 * *previous* calendar day west of Greenwich; this parses at local noon, which
 * is the stored day in every zone.
 *
 * A full timestamp still formats, via {@link parseInstantOrBareLocalNoon}, so a
 * column that changes shape degrades to the old rendering rather than to a
 * placeholder.
 */
export function formatBareDate(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const parsed = parseInstantOrBareLocalNoon(value);
  return parsed ? parsed.toLocaleDateString() : "—";
}
