/**
 * Whole-calendar-day arithmetic between two instants.
 *
 * Separate from `bare-date.ts`, which parses a `YYYY-MM-DD` into an instant.
 * This module answers the question after that one: how many calendar days
 * apart are two instants that already exist?
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days between two instants, ignoring time of day.
 *
 * `Date.UTC` of each *local* Y/M/D — the arithmetic is done in UTC only to
 * sidestep DST, while the calendar days themselves stay local. Subtracting the
 * raw timestamps instead would answer "how many 24-hour spans", which is a
 * different question: 11pm to 1am is one calendar day apart and two hours
 * elapsed, and every "due tomorrow" / "TODAY vs EARLIER" split wants the
 * former.
 *
 * The local-calendar reading is deliberate, not incidental. Do not swap it for
 * a UTC-date split: a `created_at` of `2026-08-17T09:00:00.000Z` is yesterday
 * evening in Tokyo when `now` is `2026-08-17T20:00:00.000Z` (18:00 on the 17th
 * against 05:00 on the 18th), so the local reading answers 1 and a UTC-date
 * split answers 0 — it would file the row under TODAY for a reader who last
 * saw it the night before.
 *
 * Callers guard `Invalid Date` themselves; `NaN` in gives `NaN` out. One sharp
 * edge worth knowing: `Date.UTC` remaps years 0–99 to 1900+year, so a stored
 * date of `0026-08-17` — which the bare-date regex accepts — reads as 1926 and
 * yields a delta ~1900 years wide rather than an obviously bad value.
 */
export function dayDelta(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}
