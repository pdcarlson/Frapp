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
 * reads empty. The page then opens as a list, and a pick made in it holds in
 * memory for the tab's life.
 */
export type ListLayout = "list" | "grid";

/** The screens that offer the toggle. A new one joins here. */
export type ListLayoutScreen = "directory";

export function listLayoutStorageKey(
  screen: ListLayoutScreen,
  userId: string,
): string {
  return `frapp.${screen}.layout.${userId}`;
}

export function parseListLayout(raw: unknown): ListLayout | null {
  return raw === "list" || raw === "grid" ? raw : null;
}

/** Picks a failed write could not store, so they still hold this tab's life. */
const unsaved = new Map<string, ListLayout>();
const listeners = new Set<() => void>();

export function readListLayout(
  screen: ListLayoutScreen,
  userId: string | null | undefined,
): ListLayout | null {
  if (!userId || typeof window === "undefined") return null;
  const key = listLayoutStorageKey(screen, userId);
  const held = unsaved.get(key);
  if (held) return held;
  try {
    return parseListLayout(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeListLayout(
  screen: ListLayoutScreen,
  userId: string | null | undefined,
  layout: ListLayout,
): void {
  if (!userId || typeof window === "undefined") return;
  const key = listLayoutStorageKey(screen, userId);
  try {
    window.localStorage.setItem(key, layout);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, layout);
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
 * list.
 */
export function useListLayout(
  screen: ListLayoutScreen,
): [ListLayout, (next: ListLayout) => void] {
  const userId = useViewerUserId();
  const layout = useSyncExternalStore(
    subscribe,
    () => readListLayout(screen, userId) ?? "list",
    () => "list" as const,
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
