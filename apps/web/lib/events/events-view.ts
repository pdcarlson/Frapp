import {
  parseCalendarLayers,
  type CalendarLayer,
} from "@repo/hooks/calendar-tasks";

export type EventsView = "list" | "calendar";

/**
 * The Events page's last view (List or Calendar) on this browser, per user
 * (#3822): the page opens where this person left it. Not on the server: a
 * phone and a laptop each keep their own, like the last chat channel
 * (`lib/chat/last-channel.ts`).
 *
 * localStorage, best-effort: a private window, blocked site data or a full
 * quota throws or reads empty, and the page then opens by its first-load rule
 * (the calendar for a chapter with no events, else the list).
 */
export function eventsViewStorageKey(userId: string): string {
  return `frapp.events.view.${userId}`;
}

export function readEventsView(
  userId: string | null | undefined,
): EventsView | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(eventsViewStorageKey(userId));
    return stored === "list" || stored === "calendar" ? stored : null;
  } catch {
    return null;
  }
}

export function writeEventsView(
  userId: string | null | undefined,
  view: EventsView,
): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(eventsViewStorageKey(userId), view);
  } catch {
    /* Best-effort: the choice holds for this page's life. */
  }
}

/**
 * What the calendar shows (#4144): events, the viewer's tasks, the tasks they
 * assigned. Kept the same way and for the same reason as the view: a member
 * who turns their tasks off finds them off next time. `null` when nothing is
 * stored, which means everything on.
 */
export function readCalendarLayers(
  userId: string | null | undefined,
): Set<CalendarLayer> | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    return parseCalendarLayers(
      window.localStorage.getItem(`frapp.events.calendar-layers.${userId}`),
    );
  } catch {
    return null;
  }
}

export function writeCalendarLayers(
  userId: string | null | undefined,
  layers: ReadonlySet<CalendarLayer>,
): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `frapp.events.calendar-layers.${userId}`,
      JSON.stringify([...layers]),
    );
  } catch {
    /* Best-effort, as the view. */
  }
}
