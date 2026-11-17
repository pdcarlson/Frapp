/**
 * The weekday initials, Sunday first, that head the month grid's columns
 * (`components/events/events-calendar.tsx`) and Activity's week strip
 * (`components/activity/week-strip.tsx`), so a day reads the same letter on
 * both. Index by `Date.getDay()`.
 */
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;
