import { parseActivityFilter, type ActivityFilter } from "@repo/hooks";
import { createStoredPreference } from "@/lib/stored-preference";

/**
 * The Activity screen's last chip on this phone (#4402): the screen opens on
 * the filter the member left it on. Per device, as the Events tab's view is
 * (`lib/events/events-view.ts`); web keeps its own per browser.
 *
 * Only chips are kept: the To confirm tile's narrowing is a moment's
 * shortcut, so picking it leaves the stored chip as it was.
 */
export const ACTIVITY_FILTER_STORAGE_KEY = "frapp.activity.filter";

const preference = createStoredPreference<ActivityFilter>({
  key: ACTIVITY_FILTER_STORAGE_KEY,
  parse: (raw) => parseActivityFilter(raw) ?? "all",
  fallback: "all",
});

export const useStoredActivityFilter = preference.use;
export const resetActivityFilterForTests = preference.resetForTests;

export function storeActivityFilter(filter: ActivityFilter): void {
  if (parseActivityFilter(filter) !== null) preference.set(filter);
}
