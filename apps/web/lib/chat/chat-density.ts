"use client";

import { useSyncExternalStore } from "react";
import {
  CHAT_DENSITY_STORAGE_KEY,
  DEFAULT_CHAT_DENSITY,
  parseChatDensity,
  type ChatDensity,
} from "@repo/chat-core/density";

/**
 * The member's chat density on this browser (`@repo/chat-core/density`).
 *
 * localStorage, best-effort: a private window or blocked site data throws or
 * reads empty, and the thread draws cozy. One module-level listener set, so
 * the Profile control and every mounted row move together; the `storage`
 * event carries a change made in another tab.
 */
const listeners = new Set<() => void>();

function read(): ChatDensity {
  if (typeof window === "undefined") return DEFAULT_CHAT_DENSITY;
  try {
    return parseChatDensity(
      window.localStorage.getItem(CHAT_DENSITY_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_CHAT_DENSITY;
  }
}

/*
  The snapshot is cached rather than re-read on every `getSnapshot`: React
  calls it on each render of every subscribed row, and a virtualized thread
  renders a lot of rows.
*/
let snapshot: ChatDensity | null = null;

function getSnapshot(): ChatDensity {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): ChatDensity {
  return DEFAULT_CHAT_DENSITY;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== CHAT_DENSITY_STORAGE_KEY) return;
  snapshot = read();
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function useChatDensity(): ChatDensity {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setChatDensity(density: ChatDensity): void {
  snapshot = density;
  try {
    window.localStorage.setItem(CHAT_DENSITY_STORAGE_KEY, density);
  } catch {
    /* Best-effort: the choice holds for this page's life. */
  }
  notify();
}

/** Test seam: forget the cached read so a spec can seed storage first. */
export function resetChatDensityForTests(): void {
  snapshot = null;
}
