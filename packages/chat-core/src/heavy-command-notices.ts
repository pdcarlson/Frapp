/**
 * Local persistence for the heavy-command rows the server will never return:
 * `_status: "recorded"` (#1789) and `_status: "unconfirmed"` (#1909).
 *
 * Both are cache-only on the wire. The server either never wrote a chat
 * message (`recorded`: the write committed, the card did not) or nobody knows
 * whether it did (`unconfirmed`: the response was lost). Every ordinary event
 * that rebuilds the channel from REST (a reconnect's `refetchOnReconnect:
 * "always"`, a reload, a `gcTime` eviction) would drop the row. For
 * `unconfirmed` that also drops the only Retry that replays the original
 * idempotency key, and the officer's next move is re-typing the command, which
 * mints a fresh key and double-grants into an append-only ledger. The rebuild
 * that matters most is the reconnect that follows the very outage that lost the
 * response.
 *
 * So both survive the way an outbox row does: a small `KeyValueStore` list per
 * channel, re-merged after every REST rebuild. One list for both states, keyed
 * by `client_message_id`, so a replay that comes back `card_posted: false`
 * *replaces* its `unconfirmed` entry with a `recorded` one rather than leaving
 * two. Not the `OutboxStore` port: heavy commands bypass the outbox on purpose,
 * and widening that port would oblige `apps/mobile` to implement a second
 * store for rows it cannot produce.
 *
 * **Eviction is on confirmation.** The Realtime echo or backfill of the real
 * card (`realtime-manager.ts`), a retry that resolves or is refused as spent
 * (`removeLocalPlaceholder`), or a REST rebuild that already carries the card
 * (`mergePersistedNotices`) all drop the entry. The echo has to evict eagerly,
 * not at the next load: once the card falls out of the 50-row window a later
 * load cannot see it, so an entry still on disk would come back as a stale
 * Retry weeks later.
 *
 * **An entry is restored only into the view of the member who dispatched it.**
 * The store is per browser, not per member, and `idx_point_transactions_dedupe`
 * is `(chapter_id, client_message_id)`: a second officer on a shared machine
 * pressing another officer's Retry gets a 409 when the original committed, but
 * writes a fresh grant under their own name when it did not.
 */

import {
  browserKeyValueStore,
  type KeyValueStore,
} from "./adapters";
import {
  locateRow,
  markRecorded,
  markUnconfirmed,
  upsertOptimistic,
} from "./cache";
import {
  optimisticMessage,
  type ChannelCache,
  type ReplayRequest,
} from "./types";

interface NoticeFields {
  clientMessageId: string;
  channelId: string;
  senderId: string;
  content: string;
  note: string;
  createdAt: string;
}

/** The write committed and the chat card did not. No replay: Retry is dangerous. */
export interface RecordedNotice extends NoticeFields {
  status: "recorded";
}

/** The response was lost. Carries exactly what an explicit Retry replays. */
export interface UnconfirmedNotice extends NoticeFields {
  status: "unconfirmed";
  replay: ReplayRequest;
}

export type HeavyCommandNotice = RecordedNotice | UnconfirmedNotice;

/**
 * Still `chat:recorded:` although the list now holds `unconfirmed` entries
 * too: #1789 shipped this key, and renaming it would orphan every `recorded`
 * entry already on disk. The key is never shown to anyone.
 */
function storageKey(channelId: string): string {
  return `chat:recorded:${channelId}`;
}

function kvOf(store?: KeyValueStore): KeyValueStore {
  return store ?? browserKeyValueStore;
}

export function readNotices(
  channelId: string,
  store?: KeyValueStore,
): HeavyCommandNotice[] {
  const raw = kvOf(store).get(storageKey(channelId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      kvOf(store).remove(storageKey(channelId));
      return [];
    }
    return parsed.flatMap((value) => {
      const notice = toNotice(value, channelId);
      return notice ? [notice] : [];
    });
  } catch {
    kvOf(store).remove(storageKey(channelId));
    return [];
  }
}

export function persistNotice(
  notice: HeavyCommandNotice,
  store?: KeyValueStore,
): void {
  const kv = kvOf(store);
  const existing = readNotices(notice.channelId, kv);
  const next = [
    ...existing.filter((row) => row.clientMessageId !== notice.clientMessageId),
    notice,
  ];
  kv.set(storageKey(notice.channelId), JSON.stringify(next));
}

/**
 * Drop the entries for these `client_message_id`s, if any are stored.
 *
 * Called on every Realtime echo, so the common case (nothing stored for the
 * channel, or nothing matching) must not write: it reads once and returns.
 */
export function dropNotices(
  channelId: string,
  clientMessageIds: Iterable<string | null | undefined>,
  store?: KeyValueStore,
): void {
  const ids = new Set<string>();
  for (const id of clientMessageIds) if (id) ids.add(id);
  if (ids.size === 0) return;
  const kv = kvOf(store);
  const existing = readNotices(channelId, kv);
  if (existing.length === 0) return;
  const next = existing.filter((row) => !ids.has(row.clientMessageId));
  if (next.length === existing.length) return;
  if (next.length === 0) {
    kv.remove(storageKey(channelId));
    return;
  }
  kv.set(storageKey(channelId), JSON.stringify(next));
}

/**
 * Put a notice's row into a cache: insert the `loading` placeholder when the
 * cache has none (a REST rebuild dropped it), then set its status.
 *
 * The one place a notice becomes a row, so a live dispatch and a restore after
 * a rebuild cannot draw two different rows for the same notice.
 */
export function applyNotice(
  cache: ChannelCache,
  notice: HeavyCommandNotice,
): ChannelCache {
  let next = cache;
  if (!next.byId[notice.clientMessageId]) {
    const row = optimisticMessage({
      clientMessageId: notice.clientMessageId,
      channelId: notice.channelId,
      senderId: notice.senderId,
      content: notice.content,
      kind: "loading",
      payload: null,
      replyToId: null,
    });
    row.created_at = notice.createdAt;
    next = upsertOptimistic(next, row);
  }
  return notice.status === "recorded"
    ? markRecorded(next, notice.clientMessageId, notice.note)
    : markUnconfirmed(
        next,
        notice.clientMessageId,
        notice.replay,
        notice.note,
      );
}

/**
 * Re-insert the viewer's persisted rows that the REST rebuild did not already
 * confirm. A confirmed card prunes its entry, so a healed row does not come
 * back as a ghost on the next load.
 *
 * `viewerId` is required, not defaulted: with no viewer there is no way to
 * tell whose entries these are, so nothing is restored (and nothing dropped).
 * Callers re-merge once the viewer resolves.
 */
export function mergePersistedNotices(
  cache: ChannelCache,
  args: {
    channelId: string;
    viewerId: string | null | undefined;
    kv?: KeyValueStore;
  },
): ChannelCache {
  const notices = readNotices(args.channelId, args.kv);
  if (notices.length === 0) return cache;
  let next = cache;
  const confirmed: string[] = [];
  for (const notice of notices) {
    const placement = locateRow(next, notice.clientMessageId);
    if (placement === "confirmed") {
      confirmed.push(notice.clientMessageId);
      continue;
    }
    // Still in the cache: this session's row is newer than the stored copy.
    if (placement === "optimistic") continue;
    if (!args.viewerId || notice.senderId !== args.viewerId) continue;
    next = applyNotice(next, notice);
  }
  dropNotices(args.channelId, confirmed, args.kv);
  return next;
}

/**
 * Validate one stored entry. Anything malformed is dropped rather than
 * repaired: a replay handle rebuilt from a partial record would send a
 * *different* request under the original key, which the server answers with a
 * 409 at best and a wrong write at worst.
 */
function toNotice(value: unknown, channelId: string): HeavyCommandNotice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.clientMessageId !== "string" ||
    row.channelId !== channelId ||
    typeof row.senderId !== "string" ||
    typeof row.content !== "string" ||
    typeof row.note !== "string" ||
    typeof row.createdAt !== "string"
  ) {
    return null;
  }
  const fields: NoticeFields = {
    clientMessageId: row.clientMessageId,
    channelId,
    senderId: row.senderId,
    content: row.content,
    note: row.note,
    createdAt: row.createdAt,
  };
  // #1789 entries predate `status`; every one of them is `recorded`.
  if (row.status === undefined || row.status === "recorded") {
    return { ...fields, status: "recorded" };
  }
  if (
    row.status === "unconfirmed" &&
    isReplayFor(row.replay, fields.clientMessageId, channelId)
  ) {
    return { ...fields, status: "unconfirmed", replay: row.replay };
  }
  return null;
}

function isReplayFor(
  value: unknown,
  clientMessageId: string,
  channelId: string,
): value is ReplayRequest {
  if (!value || typeof value !== "object") return false;
  const replay = value as Record<string, unknown>;
  if (
    replay.command !== "points" ||
    replay.channelId !== channelId ||
    replay.clientMessageId !== clientMessageId
  ) {
    return false;
  }
  const body = replay.body;
  if (!body || typeof body !== "object") return false;
  const fields = body as Record<string, unknown>;
  return (
    fields.client_message_id === clientMessageId &&
    fields.channel_id === channelId &&
    typeof fields.target_user_id === "string" &&
    typeof fields.amount === "number" &&
    Number.isInteger(fields.amount) &&
    (fields.category === "MANUAL" || fields.category === "FINE") &&
    typeof fields.reason === "string"
  );
}
