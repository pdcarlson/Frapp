"use client";

import { useSyncExternalStore } from "react";
import {
  RECENT_EMOJI_STORAGE_KEY,
  parseRecentEmoji,
  serializeRecentEmoji,
  withRecentEmoji,
} from "@repo/chat-core/emoji-recent";

/**
 * The member's recent emoji on this browser (`@repo/chat-core/emoji-recent`),
 * drawn first in the emoji picker.
 *
 * localStorage, best-effort: a private window or blocked site data reads as
 * no recents and the picker opens on Smileys. The snapshot is cached so every
 * render reads one array; the `storage` event carries a use in another tab.
 */
const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly string[] | null = null;

/** The stored list, or `fallback` where storage can't be read. */
function read(fallback: readonly string[] = EMPTY): readonly string[] {
  if (typeof window === "undefined") return fallback;
  try {
    return parseRecentEmoji(
      window.localStorage.getItem(RECENT_EMOJI_STORAGE_KEY),
    );
  } catch {
    return fallback;
  }
}

function getSnapshot(): readonly string[] {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== RECENT_EMOJI_STORAGE_KEY) return;
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

/** Most recent first. Empty until the first use on this browser. */
export function useRecentEmoji(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Records an emoji the member just reacted with or inserted. */
export function recordRecentEmoji(emoji: string): void {
  // Re-read rather than trust the cache: another tab may have written since.
  // Where storage throws, the list this page already holds carries on.
  snapshot = withRecentEmoji(read(getSnapshot()), emoji);
  try {
    window.localStorage.setItem(
      RECENT_EMOJI_STORAGE_KEY,
      serializeRecentEmoji(snapshot),
    );
  } catch {
    /* Best-effort: the list holds for this page. */
  }
  notify();
}

/** Test seam: forget the cached read. */
export function resetRecentEmojiForTests(): void {
  snapshot = null;
}
