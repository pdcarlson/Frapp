/**
 * `KeyValueStore` for React Native, backed by AsyncStorage.
 *
 * The port is **synchronous** (`packages/chat-core/src/adapters.ts`) because it
 * was extracted from code that called `localStorage` inline. AsyncStorage is
 * not, so this bridges the two with a boot-hydrated in-memory mirror and
 * write-behind persistence:
 *
 * - `get` reads the mirror and returns immediately.
 * - `set` / `remove` update the mirror synchronously, then fire the AsyncStorage
 *   write without awaiting it.
 *
 * That is safe **for this port's only consumer**. `chat-core` uses it for one
 * thing: the `chat:lastSeen:<channelId>` backfill cursor
 * (`realtime-manager.ts`). A missed read widens the backfill window — the
 * manager refetches from further back and dedupes — rather than losing a
 * message, so a cold mirror costs bandwidth, not data. Do not add a consumer
 * with stricter durability needs without revisiting this.
 *
 * MMKV would give a genuinely synchronous store and remove the seam, but it
 * needs a native build and mobile currently runs in Expo Go
 * (`spec/ui/mobile/README.md`), so it is not an option yet.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "@repo/chat-core/adapters";

/** Only keys under this prefix are hydrated — see the module comment. */
export const CHAT_KV_PREFIX = "chat:";

export interface HydratableKeyValueStore extends KeyValueStore {
  /**
   * Loads existing `chat:`-prefixed keys into the mirror. Call once at boot,
   * before the realtime manager subscribes. Safe to call again; it merges
   * rather than replaces, so writes made while hydration was in flight are not
   * clobbered by the slower disk read.
   */
  hydrate(): Promise<void>;
  /** Test seam: drops the mirror without touching AsyncStorage. */
  reset(): void;
}

/**
 * The slice of AsyncStorage this adapter uses, stated structurally rather than
 * as `Pick<typeof AsyncStorage, …>`. AsyncStorage's own signatures carry
 * `readonly` arrays and optional legacy callbacks that a test double should not
 * have to reproduce, and pinning to them makes the fake, not the contract, the
 * thing that has to change.
 */
export interface KeyValueBackend {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(
    keys: readonly string[],
  ): Promise<readonly (readonly [string, string | null])[]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createAsyncStorageKeyValueStore(
  storage: KeyValueBackend = AsyncStorage,
): HydratableKeyValueStore {
  const mirror = new Map<string, string>();
  /**
   * Keys written or removed locally. Hydration must not overwrite these: the
   * in-memory value is newer than whatever the disk read observed.
   */
  const dirty = new Set<string>();

  return {
    async hydrate() {
      try {
        const keys = await storage.getAllKeys();
        const chatKeys = keys.filter((key) => key.startsWith(CHAT_KV_PREFIX));
        if (chatKeys.length === 0) return;

        const entries = await storage.multiGet(chatKeys);
        for (const [key, value] of entries) {
          if (value === null || dirty.has(key)) continue;
          mirror.set(key, value);
        }
      } catch {
        // A failed hydration leaves the mirror empty, which reads as "no
        // cursor" and widens the backfill. Degrading is correct here; throwing
        // would take down chat boot for a cache miss.
      }
    },

    get(key) {
      return mirror.get(key) ?? null;
    },

    set(key, value) {
      mirror.set(key, value);
      dirty.add(key);
      void storage.setItem(key, value).catch(() => {
        // Write-behind: the mirror already has it, so the running session is
        // correct. Losing the disk write only widens the next boot's backfill.
      });
    },

    remove(key) {
      mirror.delete(key);
      dirty.add(key);
      void storage.removeItem(key).catch(() => {
        // Same degradation as `set`.
      });
    },

    reset() {
      mirror.clear();
      dirty.clear();
    },
  };
}
