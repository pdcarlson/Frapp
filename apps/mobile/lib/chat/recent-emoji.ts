import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  RECENT_EMOJI_STORAGE_KEY,
  parseRecentEmoji,
  serializeRecentEmoji,
  withRecentEmoji,
} from "@repo/chat-core/emoji-recent";

/**
 * The member's recent emoji on this phone (`@repo/chat-core/emoji-recent`),
 * drawn first in the emoji picker.
 *
 * Not `createStoredPreference`: that one lets a choice made before the stored
 * read win over it, which is right for a setting and wrong for a list, where
 * a reaction on a cold start would wipe every earlier recent. Here a use waits
 * for the read, then lands on top of what was stored. Best-effort both ways:
 * a storage error reads as no recents, and a failed write keeps the list until
 * the app restarts.
 */
const EMPTY: readonly string[] = [];
let recent: readonly string[] = EMPTY;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function hydrate(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(RECENT_EMOJI_STORAGE_KEY)
      .then((raw) => {
        const stored = parseRecentEmoji(raw);
        if (stored.length > 0) {
          recent = stored;
          notify();
        }
      })
      .catch(() => {
        /* No recents; the picker opens on Smileys. */
      });
  }
  return hydration;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void hydrate();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => recent;

/** Most recent first. Empty until the first use on this phone. */
export function useRecentEmoji(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Records a reaction the member just added, after the stored list is read. */
export function recordRecentEmoji(emoji: string): void {
  void hydrate().then(() => {
    recent = withRecentEmoji(recent, emoji);
    notify();
    AsyncStorage.setItem(
      RECENT_EMOJI_STORAGE_KEY,
      serializeRecentEmoji(recent),
    ).catch(() => {
      /* Best-effort: the list holds until the app restarts. */
    });
  });
}

/** Test seam: back to a fresh process. */
export function resetRecentEmojiForTests(): void {
  recent = EMPTY;
  hydration = null;
  listeners.clear();
}
