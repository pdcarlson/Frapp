import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHAT_DENSITY_STORAGE_KEY,
  DEFAULT_CHAT_DENSITY,
  parseChatDensity,
  type ChatDensity,
} from "@repo/chat-core/density";

/**
 * The member's chat density on this phone (`@repo/chat-core/density`).
 *
 * AsyncStorage, read once per app process on the first subscriber and held in
 * memory after that, so every row in a long thread reads a module variable
 * rather than storage. The read starts when this module loads, which is app
 * start (the thread's rows import it), so it has landed long before a member
 * opens a thread; until it does, rows draw cozy. Best-effort both ways: a storage error
 * reads as cozy, and a failed write keeps the choice until the app restarts.
 */
let density: ChatDensity = DEFAULT_CHAT_DENSITY;
let hydration: Promise<void> | null = null;
/** Set by a choice made in this process, which the stored read must not undo. */
let chosen = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Reads the stored choice once; a choice made before the read lands wins. */
export function hydrateChatDensity(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(CHAT_DENSITY_STORAGE_KEY)
      .then((raw) => {
        if (chosen) return;
        const stored = parseChatDensity(raw);
        if (stored !== density) {
          density = stored;
          notify();
        }
      })
      .catch(() => {
        /* Cozy, the default, stands. */
      });
  }
  return hydration;
}

void hydrateChatDensity();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void hydrateChatDensity();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChatDensity {
  return density;
}

export function useChatDensity(): ChatDensity {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setChatDensity(next: ChatDensity): void {
  chosen = true;
  density = next;
  notify();
  AsyncStorage.setItem(CHAT_DENSITY_STORAGE_KEY, next).catch(() => {
    /* Best-effort: the choice holds until the app restarts. */
  });
}

/** Test seam: back to a fresh process. */
export function resetChatDensityForTests(): void {
  density = DEFAULT_CHAT_DENSITY;
  hydration = null;
  chosen = false;
  listeners.clear();
}
