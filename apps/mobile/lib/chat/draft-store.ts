/**
 * Composer draft persistence for React Native.
 *
 * `OutboxStore.clearDraft` is on the chat-core port because it sits on the send
 * hot path, but the *write* half was never a port method — web keeps it in
 * `apps/web/lib/chat/offline-queue.ts` (`saveDraft` / `loadDraft`, Dexie), and
 * mobile had no equivalent. That left `createAsyncStorageOutboxStore.clearDraft`
 * removing a `chat:draft:<channelId>` key nothing ever wrote. This is the
 * missing half, deliberately reading and writing the exact same key so the
 * existing clear keeps working untouched.
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
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { DRAFT_PREFIX } from "./outbox-store";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

function draftKey(channelId: string): string {
  return `${DRAFT_PREFIX}${channelId}`;
}

export interface DraftStore {
  load(channelId: string): Promise<string>;
  save(channelId: string, body: string): Promise<void>;
  clear(channelId: string): Promise<void>;
}

export function createAsyncStorageDraftStore(
  storage: Storage = AsyncStorage,
): DraftStore {
  return {
    async load(channelId) {
      try {
        return (await storage.getItem(draftKey(channelId))) ?? "";
      } catch {
        return "";
      }
    },

    async save(channelId, body) {
      try {
        // An empty draft is a removal, not a stored empty string — otherwise
        // clearing the composer leaves a key behind that `listQueued`-style
        // sweeps and future migrations have to know to ignore.
        if (body.length === 0) {
          await storage.removeItem(draftKey(channelId));
          return;
        }
        await storage.setItem(draftKey(channelId), body);
      } catch {
        // Storage full or unavailable — the draft simply does not persist.
      }
    },

    async clear(channelId) {
      try {
        await storage.removeItem(draftKey(channelId));
      } catch {
        // Same degradation as `save`.
      }
    },
  };
}

/** Process-wide instance, matching the other chat adapters' singleton scope. */
export const chatDraftStore = createAsyncStorageDraftStore();
