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

/** Midnight on the first of `date`'s month, local time. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * The 42 days (six weeks of seven, Sunday first) a month calendar draws for
 * `anchor`'s month: from the Sunday on or before the 1st, so every month draws
 * the same height however many weeks it spans. Each day is local midnight.
 *
 * Mobile's Events calendar draws it (#3792), and so does web's date field
 * month (`apps/web/components/ui/date-field.tsx`, #3937); web's Events
 * calendar still builds the same days with its own `buildMonthGrid`. Built by
 * calendar date rather than by adding 24 hours, which a DST change would knock
 * an hour off and, past enough cells, onto the wrong day.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    days.push(
      new Date(
        first.getFullYear(),
        first.getMonth(),
        1 - first.getDay() + index,
      ),
    );
  }
  return days;
}
