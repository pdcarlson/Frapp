import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which view the Events tab opens on, List or Calendar (#3792, #3823): the
 * last one the member picked on this phone. Per device, which the owner said
 * is enough (#3823), so it lives in AsyncStorage, not on the account.
 *
 * The same shape as `lib/chat/chat-density.ts`: read once per app process and
 * held in memory, best-effort both ways. A cold start can draw the List for a
 * frame before the stored Calendar lands; a storage error reads as List, and
 * a failed write keeps the choice until the app restarts.
 */
export type EventsView = "list" | "calendar";

export const EVENTS_VIEW_STORAGE_KEY = "frapp.events.view";

export function parseEventsView(raw: unknown): EventsView {
  return raw === "calendar" ? "calendar" : "list";
}

let view: EventsView = "list";
let hydration: Promise<void> | null = null;
/** Set by a choice made in this process, which the stored read must not undo. */
let chosen = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Reads the stored choice once; a choice made before the read lands wins. */
export function hydrateEventsView(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(EVENTS_VIEW_STORAGE_KEY)
      .then((raw) => {
        if (chosen) return;
        const stored = parseEventsView(raw);
        if (stored !== view) {
          view = stored;
          notify();
        }
      })
      .catch(() => {
        /* List, the default, stands. */
      });
  }
  return hydration;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void hydrateEventsView();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EventsView {
  return view;
}

export function useEventsView(): EventsView {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setEventsView(next: EventsView): void {
  chosen = true;
  view = next;
  notify();
  AsyncStorage.setItem(EVENTS_VIEW_STORAGE_KEY, next).catch(() => {
    /* Best-effort: the choice holds until the app restarts. */
  });
}

/** Test seam: back to a fresh process. */
export function resetEventsViewForTests(): void {
  view = "list";
  hydration = null;
  chosen = false;
  listeners.clear();
}
