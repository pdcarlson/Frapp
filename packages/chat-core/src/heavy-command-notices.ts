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
 * member per channel, re-merged after every REST rebuild. One list for both
 * states, keyed by `client_message_id`, so a replay that comes back
 * `card_posted: false` *replaces* its `unconfirmed` entry with a `recorded` one
 * rather than leaving two. Not the `OutboxStore` port: heavy commands bypass
 * the outbox on purpose, and widening that port would oblige `apps/mobile` to
 * implement a second store for rows it cannot produce.
 *
 * **Keyed by the member who dispatched, never wiped** — the outbox's rule
 * (`spec/ui/resilience/caching.md`), for the outbox's reason. An entry carries
 * a replay body (target, amount, reason), and the store is per browser: keying
 * it by `users.id` is what keeps one member's entries unreachable from another
 * member's session on a shared machine. Wiping on sign-out would be the other
 * way to get there, and would strand the member's own Retry the way it would
 * strand their unsent message. The same key is also the replay boundary:
 * `idx_point_transactions_dedupe` is `(chapter_id, client_message_id)`, so a
 * second officer pressing another officer's Retry would get a 409 when the
 * original committed, but would write a fresh grant under their own name when
 * it did not.
 *
 * What evicts an entry, and how long one may live, is stated once, in
 * `spec/behavior/chat/integrations.md` § Slash command dispatch.
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
  /** The member who dispatched; also the key the entry is filed under. */
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
 * How long an `unconfirmed` entry is restored: one day.
 *
 * Its Retry is the right recovery while the outcome is genuinely open — the
 * reconnect, the reload, the next look at the channel. A day on, the officer
 * has had all of those and the points ledger to settle it, and a Retry pressed
 * then is more likely to write a grant they already re-typed than to recover
 * one that was lost: a key that never committed is replayed as a first write.
 * A card that arrives, or a retry that settles, evicts it sooner. `recorded`
 * entries carry no Retry and are not aged out.
 */
export const UNCONFIRMED_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(ownerId: string, channelId: string): string {
  return `chat:heavy:v1:${ownerId}:${channelId}`;
}

/**
 * Where #1789 filed `recorded` entries: per channel, for every member alike.
 * Read only to adopt the reader's own entries into their keyed list (see
 * {@link readNotices}); nothing is written here any more.
 */
function legacyKey(channelId: string): string {
  return `chat:recorded:${channelId}`;
}

function kvOf(store?: KeyValueStore): KeyValueStore {
  return store ?? browserKeyValueStore;
}

/** The stored list at `key`, validated for this owner and channel. */
function readList(
  kv: KeyValueStore,
  key: string,
  channelId: string,
  ownerId: string,
): HeavyCommandNotice[] {
  const raw = kv.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      kv.remove(key);
      return [];
    }
    return parsed.flatMap((value) => {
      const notice = toNotice(value, channelId, ownerId);
      return notice ? [notice] : [];
    });
  } catch {
    kv.remove(key);
    return [];
  }
}

function writeList(
  kv: KeyValueStore,
  key: string,
  notices: HeavyCommandNotice[],
): void {
  if (notices.length === 0) {
    kv.remove(key);
    return;
  }
  kv.set(key, JSON.stringify(notices));
}

/**
 * Move the owner's entries out of the #1789 per-channel list, leaving other
 * members' entries where they are until their owners read them. Legacy entries
 * are all `recorded` and each carries the `senderId` it was written for, so
 * each can be handed to exactly one member.
 */
function adoptLegacy(
  kv: KeyValueStore,
  channelId: string,
  ownerId: string,
): HeavyCommandNotice[] {
  const raw = kv.get(legacyKey(channelId));
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    kv.remove(legacyKey(channelId));
    return [];
  }
  if (!Array.isArray(parsed)) {
    kv.remove(legacyKey(channelId));
    return [];
  }
  const mine: HeavyCommandNotice[] = [];
  const others: unknown[] = [];
  for (const value of parsed) {
    const notice = toNotice(value, channelId, ownerId);
    if (notice) mine.push(notice);
    else others.push(value);
  }
  if (mine.length === 0) return [];
  if (others.length === 0) kv.remove(legacyKey(channelId));
  else kv.set(legacyKey(channelId), JSON.stringify(others));
  return mine;
}

/** The owner's entries for a channel, adopting any #1789 entries of theirs. */
export function readNotices(
  channelId: string,
  ownerId: string,
  store?: KeyValueStore,
): HeavyCommandNotice[] {
  const kv = kvOf(store);
  const key = storageKey(ownerId, channelId);
  const own = readList(kv, key, channelId, ownerId);
  const adopted = adoptLegacy(kv, channelId, ownerId);
  if (adopted.length === 0) return own;
  const ids = new Set(own.map((notice) => notice.clientMessageId));
  const merged = [
    ...own,
    ...adopted.filter((notice) => !ids.has(notice.clientMessageId)),
  ];
  writeList(kv, key, merged);
  return merged;
}

/** The owner's stored entry for one `client_message_id`, if any. */
export function findNotice(
  channelId: string,
  ownerId: string,
  clientMessageId: string,
  store?: KeyValueStore,
): HeavyCommandNotice | undefined {
  return readNotices(channelId, ownerId, store).find(
    (notice) => notice.clientMessageId === clientMessageId,
  );
}

/**
 * File a notice under the member who dispatched it. Returns whether it
 * actually landed: `KeyValueStore.set` may degrade silently (storage blocked
 * by site settings, quota exhausted), and a caller about to tell an officer the
 * row will survive a reconnect has to know whether it will.
 */
export function persistNotice(
  notice: HeavyCommandNotice,
  store?: KeyValueStore,
): boolean {
  const kv = kvOf(store);
  const key = storageKey(notice.senderId, notice.channelId);
  const next = [
    ...readNotices(notice.channelId, notice.senderId, kv).filter(
      (row) => row.clientMessageId !== notice.clientMessageId,
    ),
    notice,
  ];
  const serialized = JSON.stringify(next);
  kv.set(key, serialized);
  return kv.get(key) === serialized;
}

/**
 * Drop the owner's entries for these `client_message_id`s, if any are stored.
 *
 * Called on every Realtime echo, so the common case (nothing stored for the
 * channel, or nothing matching) must not write.
 */
export function dropNotices(
  channelId: string,
  ownerId: string,
  clientMessageIds: Iterable<string | null | undefined>,
  store?: KeyValueStore,
): void {
  const ids = new Set<string>();
  for (const id of clientMessageIds) if (id) ids.add(id);
  if (ids.size === 0) return;
  const kv = kvOf(store);
  const existing = readNotices(channelId, ownerId, kv);
  if (existing.length === 0) return;
  const next = existing.filter((row) => !ids.has(row.clientMessageId));
  if (next.length === existing.length) return;
  writeList(kv, storageKey(ownerId, channelId), next);
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

function isExpired(notice: HeavyCommandNotice, now: number): boolean {
  if (notice.status !== "unconfirmed") return false;
  const age = now - Date.parse(notice.createdAt);
  // An unparseable timestamp cannot prove the entry is young enough to keep.
  return !(age <= UNCONFIRMED_NOTICE_TTL_MS);
}

/**
 * Re-insert the viewer's persisted rows that the REST rebuild did not already
 * confirm. A confirmed card prunes its entry, so a healed row does not come
 * back as a ghost on the next load, and an `unconfirmed` entry past
 * {@link UNCONFIRMED_NOTICE_TTL_MS} is pruned rather than restored.
 *
 * `viewerId` is required, not defaulted: entries are filed per member, so with
 * no viewer there is nothing to read. Callers re-merge once the viewer resolves.
 */
export function mergePersistedNotices(
  cache: ChannelCache,
  args: {
    channelId: string;
    viewerId: string | null | undefined;
    kv?: KeyValueStore;
    /** Test seam for the age bound. */
    now?: number;
  },
): ChannelCache {
  if (!args.viewerId) return cache;
  const notices = readNotices(args.channelId, args.viewerId, args.kv);
  if (notices.length === 0) return cache;
  const now = args.now ?? Date.now();
  let next = cache;
  const settled: string[] = [];
  for (const notice of notices) {
    const placement = locateRow(next, notice.clientMessageId);
    if (placement === "confirmed" || isExpired(notice, now)) {
      settled.push(notice.clientMessageId);
      continue;
    }
    // Still in the cache: this session's row is newer than the stored copy.
    if (placement === "optimistic") continue;
    next = applyNotice(next, notice);
  }
  dropNotices(args.channelId, args.viewerId, settled, args.kv);
  return next;
}

/**
 * Validate one stored entry. Anything malformed, or filed for another member
 * or channel, is dropped rather than repaired: a replay handle rebuilt from a
 * partial record would send a *different* request under the original key,
 * which the server answers with a 409 at best and a wrong write at worst.
 */
function toNotice(
  value: unknown,
  channelId: string,
  ownerId: string,
): HeavyCommandNotice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.clientMessageId !== "string" ||
    row.channelId !== channelId ||
    row.senderId !== ownerId ||
    typeof row.content !== "string" ||
    typeof row.note !== "string" ||
    typeof row.createdAt !== "string"
  ) {
    return null;
  }
  const fields: NoticeFields = {
    clientMessageId: row.clientMessageId,
    channelId,
    senderId: ownerId,
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
