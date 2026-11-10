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

export function parseEventsView(raw: unknown): EventsView {
  return raw === "calendar" ? "calendar" : "list";
}

const preference = createStoredPreference<EventsView>({
  key: EVENTS_VIEW_STORAGE_KEY,
  parse: parseEventsView,
  fallback: "list",
});

export const hydrateEventsView = preference.hydrate;
export const useEventsView = preference.use;
export const setEventsView = preference.set;
export const resetEventsViewForTests = preference.resetForTests;
