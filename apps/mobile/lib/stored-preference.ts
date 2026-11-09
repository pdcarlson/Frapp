import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * A per-device preference kept in AsyncStorage: chat density
 * (`lib/chat/chat-density.ts`) and the Events tab's view
 * (`lib/events/events-view.ts`).
 *
 * Read once per app process and held in memory after that, so a long list's
 * rows read a module variable rather than storage. Best-effort both ways: a
 * storage error reads as the fallback, and a failed write keeps the choice
 * until the app restarts. A choice made before the stored read lands wins
 * over it, so a fast tap on a cold start is never undone by the read.
 */
export interface StoredPreference<T> {
  /** Reads the stored choice once; later calls return the same read. */
  hydrate: () => Promise<void>;
  use: () => T;
  set: (next: T) => void;
  /** Test seam: back to a fresh process. */
  resetForTests: () => void;
}

export function createStoredPreference<T extends string>({
  key,
  parse,
  fallback,
}: {
  key: string;
  /** The stored string (or `null`) as a value, falling back for anything else. */
  parse: (raw: unknown) => T;
  fallback: T;
}): StoredPreference<T> {
  let value: T = fallback;
  let hydration: Promise<void> | null = null;
  /** Set by a choice made in this process, which the stored read must not undo. */
  let chosen = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const hydrate = (): Promise<void> => {
    if (!hydration) {
      hydration = AsyncStorage.getItem(key)
        .then((raw) => {
          if (chosen) return;
          const stored = parse(raw);
          if (stored !== value) {
            value = stored;
            notify();
          }
        })
        .catch(() => {
          /* The fallback stands. */
        });
    }
    return hydration;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    void hydrate();
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => value;

  return {
    hydrate,
    use: () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    set: (next: T) => {
      chosen = true;
      value = next;
      notify();
      AsyncStorage.setItem(key, next).catch(() => {
        /* Best-effort: the choice holds until the app restarts. */
      });
    },
    resetForTests: () => {
      value = fallback;
      hydration = null;
      chosen = false;
      listeners.clear();
    },
  };
}
