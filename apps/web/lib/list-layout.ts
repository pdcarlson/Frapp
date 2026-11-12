import { useCallback, useSyncExternalStore } from "react";
import { useViewerUserId } from "@repo/hooks";

/**
 * List or Grid, for a screen that offers both (#4175): the last one this
 * person picked on this browser, per screen. Kept the way the Events page
 * keeps List/Calendar (`lib/events/events-view.ts`, #3822): in localStorage
 * under the user's id, not on the server, so a laptop and a phone each keep
 * their own.
 *
 * Per screen, not one switch for the whole app: a member who wants the
 * Directory as faces may still want Tasks as rows, and Finder and Google
 * Drive's own per-place layouts work the same way.
 *
 * Best-effort: a private window, blocked site data or a full quota throws or
 * reads empty. The page then opens in its default layout
 * ({@link DEFAULT_LIST_LAYOUT}), and a pick made in it holds in
 * memory for the tab's life; so does one made before the viewer's id is known.
 */
export type ListLayout = "list" | "grid";

/** The screens that offer the toggle. A new one joins here. */
export type ListLayoutScreen = "directory" | "documents" | "tasks";

/**
 * The layout a screen opens in before this person picks one. List, except
 * Tasks: its board of status columns was its only view and is its Grid, so
 * nobody's Tasks page changes until they flip it (#4175).
 */
export const DEFAULT_LIST_LAYOUT: Record<ListLayoutScreen, ListLayout> = {
  directory: "list",
  documents: "list",
  tasks: "grid",
};

export function listLayoutStorageKey(
  screen: ListLayoutScreen,
  userId: string,
): string {
  return `frapp.${screen}.layout.${userId}`;
}

export function parseListLayout(raw: unknown): ListLayout | null {
  return raw === "list" || raw === "grid" ? raw : null;
}

/**
 * Picks that could not be stored, so they still hold for the tab's life: a
 * write the browser refused, or one made before the viewer's id was known.
 */
const unsaved = new Map<string, ListLayout>();

function earlyKey(screen: ListLayoutScreen): string {
  return `frapp.${screen}.layout`;
}
const listeners = new Set<() => void>();

export function readListLayout(
  screen: ListLayoutScreen,
  userId: string | null | undefined,
): ListLayout | null {
  if (typeof window === "undefined") return null;
  // A pick made before the viewer resolved (offline with no cached user, or
  // the read still in flight) holds in memory under the screen alone, and
  // stands until this person's own stored pick says otherwise.
  const early = unsaved.get(earlyKey(screen)) ?? null;
  if (!userId) return early;
  const key = listLayoutStorageKey(screen, userId);
  const held = unsaved.get(key);
  if (held) return held;
  try {
    return parseListLayout(window.localStorage.getItem(key)) ?? early;
  } catch {
    return early;
  }
}

export function writeListLayout(
  screen: ListLayoutScreen,
  userId: string | null | undefined,
  layout: ListLayout,
): void {
  if (typeof window === "undefined") return;
  if (!userId) {
    // No one to store it under yet: hold it so the switch still switches.
    unsaved.set(earlyKey(screen), layout);
  } else {
    const key = listLayoutStorageKey(screen, userId);
    unsaved.delete(earlyKey(screen));
    try {
      window.localStorage.setItem(key, layout);
      unsaved.delete(key);
    } catch {
      unsaved.set(key, layout);
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab's pick lands here too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The screen's layout and its setter. Every caller on one screen reads the
 * same stored value, so a toggle in a page's tab row and the lists under it
 * stay in step. The server render, and a viewer not yet resolved, draw the
 * screen's default layout.
 */
export function useListLayout(
  screen: ListLayoutScreen,
): [ListLayout, (next: ListLayout) => void] {
  const userId = useViewerUserId();
  const layout = useSyncExternalStore(
    subscribe,
    () => readListLayout(screen, userId) ?? DEFAULT_LIST_LAYOUT[screen],
    () => DEFAULT_LIST_LAYOUT[screen],
  );
  const setLayout = useCallback(
    (next: ListLayout) => writeListLayout(screen, userId, next),
    [screen, userId],
  );
  return [layout, setLayout];
}

/** Test seam: forget the in-memory picks. */
export function resetListLayoutForTests(): void {
  unsaved.clear();
}
