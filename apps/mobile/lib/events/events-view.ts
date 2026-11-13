import { createStoredPreference } from "@/lib/stored-preference";

/**
 * Which view the Events tab opens on, List or Calendar (#3792, #3823): the
 * last one the member picked on this phone. Per device, which the owner said
 * is enough (#3823), so it lives in AsyncStorage, not on the account.
 *
 * Read when the tab first subscribes, so a cold start can draw the List for a
 * frame before a stored Calendar lands (`lib/stored-preference.ts` has the
 * rest: best-effort storage, and a pick made first wins over the read).
 */
export type EventsView = "list" | "calendar";

export const EVENTS_VIEW_STORAGE_KEY = "frapp.events.view";

function parseEventsView(raw: unknown): EventsView {
  return raw === "calendar" ? "calendar" : "list";
}

const preference = createStoredPreference<EventsView>({
  key: EVENTS_VIEW_STORAGE_KEY,
  parse: parseEventsView,
  fallback: "list",
});

export const useEventsView = preference.use;
export const setEventsView = preference.set;
export const resetEventsViewForTests = preference.resetForTests;

/**
 * What the Calendar shows (#4144): events, the member's tasks, the tasks they
 * assigned. Kept per phone like the view, as the layer names in JSON; an
 * empty string is "nothing stored", which shows everything.
 */
const calendarLayersPreference = createStoredPreference<string>({
  key: "frapp.events.calendar-layers",
  parse: (raw) => (typeof raw === "string" ? raw : ""),
  fallback: "",
});

export const useCalendarLayersRaw = calendarLayersPreference.use;
export const setCalendarLayersRaw = calendarLayersPreference.set;
export const resetCalendarLayersForTests =
  calendarLayersPreference.resetForTests;

/**
 * The Calendar's Month, 3 days or Day (#4818), remembered per phone like the
 * view. Seven columns don't fit a phone, so where web offers Week the phone
 * offers 3 days, as Google Calendar's phone app does.
 */
export type CalendarRange = "month" | "3day" | "day";

export const CALENDAR_RANGE_STORAGE_KEY = "frapp.events.calendar-range";

export function parseCalendarRange(raw: unknown): CalendarRange {
  return raw === "3day" || raw === "day" ? raw : "month";
}

const calendarRangePreference = createStoredPreference<CalendarRange>({
  key: CALENDAR_RANGE_STORAGE_KEY,
  parse: parseCalendarRange,
  fallback: "month",
});

export const useCalendarRange = calendarRangePreference.use;
export const setCalendarRange = calendarRangePreference.set;
export const resetCalendarRangeForTests = calendarRangePreference.resetForTests;

/** How many days each time-grid range shows. */
export const CALENDAR_RANGE_DAYS = { "3day": 3, day: 1 } as const;
