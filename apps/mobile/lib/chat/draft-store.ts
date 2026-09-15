/**
 * Composer draft persistence for React Native.
 *
 * `OutboxStore.clearDraft` is on the chat-core port because it sits on the send
 * hot path, but the *write* half was never a port method — web keeps it in
 * `apps/web/lib/chat/offline-queue.ts` (`saveDraft` / `loadDraft`, Dexie), and
 * mobile had no equivalent. That left `createAsyncStorageOutboxStore.clearDraft`
 * removing a draft key nothing ever wrote. This is the missing half, and it
 * derives the key from the same {@link draftKey} the clear uses rather than
 * restating the string — if the two ever disagree, a sent message leaves its
 * draft behind and the composer refills with text already sent.
 *
 * Why not the `KeyValueStore` port: its mirror is documented as sound *only*
 * because its sole consumer is the `chat:lastSeen:` backfill cursor, where a
 * stale read widens a backfill instead of losing data
 * (`spec/ui/mobile/patterns.md` § Chat). A draft read that misses loses typing,
 * so it goes straight to AsyncStorage and awaits, rather than borrowing a
 * synchronous mirror whose invariant it would break.
 *
 * Every operation degrades to a no-op on failure. A lost draft is cosmetic; it
 * must never fail the send or the screen that triggered it.
 *
 * ## Scoped to the member who typed it (#2228)
 *
 * The key carries the Supabase auth uid, so a handed-over phone cannot open
 * one member's composer showing another's unsent text. No chapter segment: a
 * channel id is a UUID unique across chapters, so member plus channel isolates
 * a draft completely. (On mobile the *queue* does not carry the chapter either,
 * for a different reason — see `chat-scope.ts`.)
 *
 * An unscoped store is inert rather than throwing: unlike a queued send, a
 * draft that does not persist loses at most the keystrokes since the last save,
 * and the composer keeps its in-memory value either way.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChatScope } from "./chat-scope";
import { draftKey } from "./outbox-store";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

export interface DraftStore {
  load(channelId: string): Promise<string>;
  save(channelId: string, body: string): Promise<void>;
  clear(channelId: string): Promise<void>;
}

export function createAsyncStorageDraftStore(
  scope: ChatScope | null,
  storage: Storage = AsyncStorage,
): DraftStore {
  const keyFor = (channelId: string) =>
    scope ? draftKey(scope, channelId) : null;

  return {
    async load(channelId) {
      const key = keyFor(channelId);
      if (!key) return "";
      try {
        return (await storage.getItem(key)) ?? "";
      } catch {
        return "";
      }
    },

    async save(channelId, body) {
      const key = keyFor(channelId);
      if (!key) return;
      try {
        // An empty draft is a removal, not a stored empty string — otherwise
        // clearing the composer leaves a key behind that future migrations
        // have to know to ignore.
        if (body.length === 0) {
          await storage.removeItem(key);
          return;
        }
        await storage.setItem(key, body);
      } catch {
        // Storage full or unavailable — the draft simply does not persist.
      }
    },

    async clear(channelId) {
      const key = keyFor(channelId);
      if (!key) return;
      try {
        await storage.removeItem(key);
      } catch {
        // Same degradation as `save`.
      }
    },
  };
}

/**
 * One store per member per process.
 *
 * Drafts have no serialization chain to protect, so this is purely about
 * identity: `use-chat-channel.ts` keys its draft-restore effect on the store,
 * and a fresh object each render would tear that effect down and re-run it —
 * the restore that follows would overwrite whatever was typed inside the
 * 400ms save debounce.
 */
const stores = new Map<string, DraftStore>();

/** Test seam — module state outlives a `renderHook`, so specs must reset it. */
export function resetDraftStoresForTests(): void {
  stores.clear();
}

/** Inert rather than throwing: a draft that does not persist loses at most the
 * keystrokes since the last save, and the composer keeps its in-memory value. */
const INERT_DRAFTS: DraftStore = {
  load: () => Promise.resolve(""),
  save: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

export function getDraftStore(scope: ChatScope | null): DraftStore {
  if (!scope) return INERT_DRAFTS;
  let store = stores.get(scope.userId);
  if (!store) {
    store = createAsyncStorageDraftStore(scope);
    stores.set(scope.userId, store);
  }
  return store;
}
