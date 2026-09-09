/**
 * Local persistence for `_status: "recorded"` heavy-command rows (#1789).
 *
 * The row is cache-only on the wire — the server never wrote a chat message —
 * so a channel reload that rebuilds from REST would drop it, and the toast
 * that used to be the only evidence is evictable (`TOAST_LIMIT = 1`). These
 * notices survive that the same way an outbox row survives: a small
 * `KeyValueStore` list per channel, re-merged after the REST backfill.
 *
 * A later Realtime echo of the real card still wins: `mergeServerRow` re-keys
 * the client id, and the next hydrate drops the persisted notice.
 */

import {
  browserKeyValueStore,
  type KeyValueStore,
} from "./adapters";
import {
  locateRow,
  markRecorded,
  upsertOptimistic,
} from "./cache";
import {
  optimisticMessage,
  type ChannelCache,
} from "./types";

export interface RecordedNotice {
  clientMessageId: string;
  channelId: string;
  senderId: string;
  content: string;
  note: string;
  createdAt: string;
}

function storageKey(channelId: string): string {
  return `chat:recorded:${channelId}`;
}

function kvOf(store?: KeyValueStore): KeyValueStore {
  return store ?? browserKeyValueStore;
}

export function readRecordedNotices(
  channelId: string,
  store?: KeyValueStore,
): RecordedNotice[] {
  const raw = kvOf(store).get(storageKey(channelId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecordedNotice);
  } catch {
    return [];
  }
}

export function persistRecordedNotice(
  notice: RecordedNotice,
  store?: KeyValueStore,
): void {
  const kv = kvOf(store);
  const existing = readRecordedNotices(notice.channelId, kv);
  const next = [
    ...existing.filter((row) => row.clientMessageId !== notice.clientMessageId),
    notice,
  ];
  kv.set(storageKey(notice.channelId), JSON.stringify(next));
}

export function dropRecordedNotice(
  channelId: string,
  clientMessageId: string,
  store?: KeyValueStore,
): void {
  const kv = kvOf(store);
  const next = readRecordedNotices(channelId, kv).filter(
    (row) => row.clientMessageId !== clientMessageId,
  );
  if (next.length === 0) {
    kv.remove(storageKey(channelId));
    return;
  }
  kv.set(storageKey(channelId), JSON.stringify(next));
}

/**
 * Re-insert persisted recorded rows that the REST backfill did not already
 * confirm. Confirmed echoes prune the notice so a healed card does not come
 * back as a ghost on the next load.
 */
export function mergePersistedRecorded(
  cache: ChannelCache,
  args: {
    channelId: string;
    userId: string;
    kv?: KeyValueStore;
  },
): ChannelCache {
  const notices = readRecordedNotices(args.channelId, args.kv);
  if (notices.length === 0) return cache;
  let next = cache;
  for (const notice of notices) {
    const placement = locateRow(next, notice.clientMessageId);
    if (placement === "confirmed") {
      dropRecordedNotice(args.channelId, notice.clientMessageId, args.kv);
      continue;
    }
    if (placement === "optimistic") continue;
    const row = optimisticMessage({
      clientMessageId: notice.clientMessageId,
      channelId: notice.channelId,
      senderId: notice.senderId || args.userId,
      content: notice.content,
      kind: "loading",
      payload: null,
      replyToId: null,
    });
    row.created_at = notice.createdAt;
    next = markRecorded(
      upsertOptimistic(next, row),
      notice.clientMessageId,
      notice.note,
    );
  }
  return next;
}

function isRecordedNotice(value: unknown): value is RecordedNotice {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.clientMessageId === "string" &&
    typeof row.channelId === "string" &&
    typeof row.senderId === "string" &&
    typeof row.content === "string" &&
    typeof row.note === "string" &&
    typeof row.createdAt === "string"
  );
}
