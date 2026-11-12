import {
  createStoredPreference,
  type StoredPreference,
} from "@/lib/stored-preference";

/**
 * List or Grid, for a screen that offers both (#4175): the last one the
 * member picked on this phone, per screen. Kept the way the Events tab keeps
 * List/Calendar (`lib/events/events-view.ts`, #3823): per device, in
 * AsyncStorage, which the owner said is enough for a view choice.
 *
 * Per screen, not one switch for the app: a member who wants the Directory as
 * faces may still want Tasks as rows, the way Finder and Google Drive keep a
 * layout per place. Web keeps the same choice per browser
 * (`apps/web/lib/list-layout.ts`).
 */
export type ListLayout = "list" | "grid";

/** The screens that offer the toggle. A new one joins here. */
export type ListLayoutScreen = "directory" | "documents";

export function listLayoutStorageKey(screen: ListLayoutScreen): string {
  return `frapp.${screen}.layout`;
}

export function parseListLayout(raw: unknown): ListLayout {
  return raw === "grid" ? "grid" : "list";
}

const preferences = new Map<ListLayoutScreen, StoredPreference<ListLayout>>();

/** One stored preference per screen, made on first use. */
export function listLayoutPreference(
  screen: ListLayoutScreen,
): StoredPreference<ListLayout> {
  let preference = preferences.get(screen);
  if (!preference) {
    preference = createStoredPreference<ListLayout>({
      key: listLayoutStorageKey(screen),
      parse: parseListLayout,
      fallback: "list",
    });
    preferences.set(screen, preference);
  }
  return preference;
}

export function useListLayout(screen: ListLayoutScreen): ListLayout {
  return listLayoutPreference(screen).use();
}

export function setListLayout(
  screen: ListLayoutScreen,
  layout: ListLayout,
): void {
  listLayoutPreference(screen).set(layout);
}

/** Test seam: every screen back to a fresh process. */
export function resetListLayoutsForTests(): void {
  for (const preference of preferences.values()) preference.resetForTests();
}
