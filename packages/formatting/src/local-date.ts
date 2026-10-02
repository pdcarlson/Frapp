/**
 * A `Date`'s calendar day as `YYYY-MM-DD`, read in the runtime's own zone:
 * what a form pre-fills as "today" and what the API's bare-date columns take.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is the UTC day: at
 * 20:00 in Los Angeles that is already tomorrow, and at 09:00 at UTC+13 it is
 * still yesterday, so an entry pre-filled that way is stored on the wrong day
 * (#3167).
 */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
