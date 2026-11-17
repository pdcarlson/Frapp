/**
 * The Day screen's `day` param (`app/(app)/calendar-day.tsx`, #5310): a
 * local calendar day written `YYYY-MM-DD`, as `localIsoDate` writes it, read
 * back as that day's local midnight. Anything else, including a date that
 * doesn't exist (`2026-02-30`), is `null`, so the screen can fall back to
 * today rather than draw a day the member never picked.
 */
export function parseCalendarDayParam(
  raw: string | null | undefined,
): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const date = Number(match[3]);
  const day = new Date(year, month, date);
  if (
    day.getFullYear() !== year ||
    day.getMonth() !== month ||
    day.getDate() !== date
  ) {
    return null;
  }
  return day;
}
