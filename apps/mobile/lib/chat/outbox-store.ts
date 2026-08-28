/**
 * `OutboxStore` for React Native, backed by AsyncStorage.
 *
 * This is the one chat-core port with **no default implementation**, on
 * purpose: "silently dropping queued sends is exactly the failure it exists to
 * prevent" (`packages/chat-core/src/adapters.ts`), so a missing outbox is a
 * compile error rather than a no-op. Web supplies a Dexie/IndexedDB store
 * (`apps/web/lib/chat/offline-queue.ts`); this is the mobile equivalent.
 *
 * The whole queue lives under a single key as a JSON array. That is the right
 * shape here — the outbox holds messages composed while offline, so it is small
 * and read whole by `listQueued`, and one key makes each mutation a single
 * atomic write. Drafts live under their own per-channel keys because
 * `clearDraft` is the only operation that touches them.
 *
 * Every mutation is funnelled through one promise chain. AsyncStorage offers no
 * compare-and-swap, so two concurrent read-modify-write cycles would lose an
 * update — and the flush loop plus a user send can genuinely overlap.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  NewOutboxRow,
  OutboxRow,
  OutboxStore,
} from "@repo/chat-core/adapters";

export const OUTBOX_KEY = "chat:outbox:v1";
export const DRAFT_PREFIX = "chat:draft:";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

export function createAsyncStorageOutboxStore(
  storage: Storage = AsyncStorage,
  now: () => number = Date.now,
): OutboxStore {
  /** Serializes read-modify-write cycles; see the module comment. */
  let tail: Promise<unknown> = Promise.resolve();

  async function readAll(): Promise<OutboxRow[]> {
    try {
      const raw = await storage.getItem(OUTBOX_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OutboxRow[]) : [];
    } catch {
      // A corrupt payload must not wedge the send path permanently. Treating it
      // as empty loses the queue, but the alternative is every send throwing
      // forever with no way back.
      return [];
    }
  }

  /** Runs `mutate` against the stored rows and persists the result. */
  function withRows<T>(
    mutate: (rows: OutboxRow[]) => { rows: OutboxRow[]; result: T },
  ): Promise<T> {
    const next = tail.then(async () => {
      const { rows, result } = mutate(await readAll());
      await storage.setItem(OUTBOX_KEY, JSON.stringify(rows));
      return result;
    });
    // Keep the chain alive even when this link rejects, so one failed write
    // does not permanently block every later mutation.
    tail = next.catch(() => undefined);
    return next;
  }

  /** Applies `patch` to one row, leaving the queue untouched if it is gone. */
  function patchRow(
    clientId: string,
    patch: (row: OutboxRow) => OutboxRow,
  ): Promise<void> {
    return withRows((rows) => ({
      rows: rows.map((row) => (row.clientId === clientId ? patch(row) : row)),
      result: undefined,
    }));
  }

  return {
    enqueue(row: NewOutboxRow) {
      return withRows((rows) => {
        const full: OutboxRow = {
          ...row,
          // Applied after the spread, not before it. `NewOutboxRow` makes these
          // three optional, and an explicitly-undefined value in the caller's
          // object would otherwise overwrite the default — leaving `attempts`
          // undefined, which `bumpAttempt` turns into NaN.
          attempts: row.attempts ?? 0,
          status: row.status ?? "queued",
          queuedAt: row.queuedAt ?? now(),
        };
        // `client_message_id` is the server's idempotency key, so a repeat
        // enqueue of the same id replaces rather than duplicates.
        const existing = rows.findIndex((r) => r.clientId === full.clientId);
        if (existing >= 0) {
          const rewritten = [...rows];
          rewritten[existing] = full;
          return { rows: rewritten, result: full };
        }
        return { rows: [...rows, full], result: full };
      });
    },

    dequeue(clientId) {
      return withRows((rows) => ({
        rows: rows.filter((row) => row.clientId !== clientId),
        result: undefined,
      }));
    },

    requeue(clientId) {
      return patchRow(clientId, (row) => ({
        ...row,
        status: "queued",
        lastError: undefined,
      }));
    },

    markFailed(clientId, error) {
      return patchRow(clientId, (row) => ({
        ...row,
        status: "failed",
        lastError: error,
      }));
    },

    bumpAttempt(clientId, error) {
      return patchRow(clientId, (row) => ({
        ...row,
        attempts: row.attempts + 1,
        lastError: error,
      }));
    },

    async listQueued() {
      // FIFO by `queuedAt` so the flush replays in composition order. Insertion
      // order already matches, but sorting keeps that true if a row is ever
      // rewritten in place.
      const rows = await readAll();
      return rows
        .filter((row) => row.status === "queued")
        .sort((a, b) => a.queuedAt - b.queuedAt);
    },

    async listForChannel(channelId) {
      const rows = await readAll();
      return rows.filter((row) => row.channelId === channelId);
    },

    async clearDraft(channelId) {
      try {
        await storage.removeItem(`${DRAFT_PREFIX}${channelId}`);
      } catch {
        // A stale draft is a cosmetic problem; it must not fail the send that
        // triggered the clear.
      }
    },
  };
}
