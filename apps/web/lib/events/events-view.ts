import {
  parseHiddenCalendarKinds,
  serializeHiddenCalendarKinds,
  type CalendarKind,
} from "@repo/hooks/calendar-tasks";

/** Where an hour-grid event starts when no hour was pressed. */
const CALENDAR_DEFAULT_START_HOUR = 18;

/**
 * The start a calendar press hands the editor: the day at `startHour`, which
 * an hour of the hour grid passes, else 6 PM (most chapter events are
 * evening ones).
 */
export function calendarCreateStart(
  day: Date,
  startHour: number = CALENDAR_DEFAULT_START_HOUR,
): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour);
}

/**
 * The kinds the Events colour key has switched off (#5560), on this browser,
 * per user: a member who turns birthdays off finds them off next time. Not on
 * the server: a phone and a laptop each keep their own, like the last chat
 * channel (`lib/chat/last-channel.ts`).
 *
 * The key replaced the calendar's layer toggles, whose stored choice
 * (`frapp.events.calendar-layers.*`) is left unread: it switched My tasks and
 * Assigned by me apart, which the key no longer does.
 *
 * localStorage, best-effort: a private window, blocked site data or a full
 * quota throws or reads empty, and every kind then shows.
 */
function hiddenKindsStorageKey(userId: string): string {
  return `frapp.events.hidden-kinds.${userId}`;
}

export function readHiddenKinds(
  userId: string | null | undefined,
): Set<CalendarKind> | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    return parseHiddenCalendarKinds(
      window.localStorage.getItem(hiddenKindsStorageKey(userId)),
    );
  } catch {
    return null;
  }
}

export function writeHiddenKinds(
  userId: string | null | undefined,
  hidden: ReadonlySet<CalendarKind>,
): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      hiddenKindsStorageKey(userId),
      serializeHiddenCalendarKinds(hidden),
    );
  } catch {
    /* Best-effort: the choice holds for this page's life. */
  }
}
