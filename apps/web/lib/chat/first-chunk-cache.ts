"use client";

/**
 * The persisted **first chunk**: the channel list and the tail of the channels
 * the member was actually reading, so a cold load can paint real rows instead
 * of waiting on `GET /v1/channels` and `GET /v1/channels/:id/messages`.
 *
 * This is the board's `1s` "first chunk" clause
 * (`spec/ui/web-greenfield/reference/` §`1s`), which
 * `spec/ui/resilience/performance-budgets.md` recorded as unbuilt: "cached
 * channel readable" measured a network round trip because there was nothing
 * cached to read.
 *
 * ## What this is NOT
 *
 * It is not `persistQueryClient`. `spec/ui/resilience/caching.md`'s 2026-09-10
 * correction rules that out and the argument is a security one: a whole-cache
 * snapshot restores `["user","me"]` and `["settings"]` after a sign-out or an
 * account swap, because those keys carry no identity to re-key on. That
 * argument is about *which* keys a persister picks up, and a persister picks up
 * every key by construction.
 *
 * This cache inverts that. It stores two kinds of row, both named explicitly,
 * and every row carries the `userId` + `chapterId` it was written under **as
 * part of its primary key**. A read is a lookup at the current scope, so a row
 * written for another member or another chapter is not merely ignored — there
 * is no key under which it can be returned. That, and not the wipe, is what
 * makes a cross-tenant read impossible; the wipe
 * (`first-chunk-wipe.ts`) and `pruneForeignScopes` below are hygiene on top of
 * it, so a member's rows do not sit on a shared machine after they leave.
 *
 * `userId` here is the **Supabase auth uid** (the JWT subject), not
 * `users.id` / `useViewerUserId`. Two reasons, and both matter:
 * `spec/behavior/multi-tenancy.md` keys the account-swap cache drop on the auth
 * uid because `["user","me"]` is not account-scoped and can lag a same-tab
 * magic-link swap — so keying this cache on anything else would let it disagree
 * with the clear that is supposed to cover it. And the auth uid is readable
 * from the local session, whereas `users.id` is a `GET /v1/users/me` round trip:
 * a first-paint cache that had to wait on the network for its own key would
 * have nothing left to win.
 *
 * ## What it holds, and what it deliberately does not
 *
 * - **Channel list** — exactly the array `["channels"]` holds, so seeding it is
 *   indistinguishable from a fetch resolving.
 * - **Message tails** — the last {@link FIRST_CHUNK_MESSAGE_LIMIT} *confirmed*
 *   rows for up to {@link FIRST_CHUNK_CHANNEL_LIMIT} channels, stored in the
 *   wire shape (`RawChatMessage`) rather than as a `ChannelCache`. Two reasons:
 *   the normalized shape is `@repo/chat-core`'s to change and a persisted copy
 *   of it would be a second definition to keep in step, and rehydrating through
 *   the canonical `mergeServerRows` means a restored row went through exactly
 *   the merge every other source goes through.
 * - **Not pending, failed, unconfirmed or recorded rows.** Those are the Dexie
 *   *outbox*'s (`offline-queue.ts`), which `hydrateOutboxIntoCache` already
 *   replays on top of whatever the timeline starts from. Persisting them here
 *   too would render each queued message twice on a cold load, and would let a
 *   stale copy of a row contradict the outbox that actually owns its status.
 * - **Not reactions or actions.** `1s` puts them after paint, and a reaction
 *   chip that paints from cache and then disagrees with the server is worse
 *   than one that arrives a moment later.
 *
 * ## Failure posture
 *
 * Every entry point swallows. IndexedDB is absent under SSR, disabled in some
 * privacy modes, and throws on quota; `use-channel-draft.ts` already degrades
 * that way for drafts, and the cost of a failure here is one ordinary cold
 * load. Nothing in the shell waits on any of these promises.
 */

import Dexie, { type Table } from "dexie";
import { toRawRow, type ChatMessage, type RawChatMessage } from "@repo/chat-core/types";
// Type-only: erased at compile time, so the channel rail's component graph is
// not on this module's runtime import graph.
import type { ChatChannel } from "@/components/chat/channel-list";
import { coldLoadDefaultChannelId } from "./default-channel";
import { FIRST_CHUNK_DB_NAME } from "./first-chunk-wipe";

/**
 * How many messages a tail holds. `1s` says "last ~30 messages"; the live
 * backfill asks for 50 and the extra 20 buy a cache row nobody sees — the
 * window a cold load paints is shorter than either number.
 */
export const FIRST_CHUNK_MESSAGE_LIMIT = 30;

/**
 * How many channels keep a tail per scope.
 *
 * One would be enough if the channel a cold load lands on were always the one
 * the member last read — it is not. `chat-shell.tsx` resolves the active
 * channel from `?channel=`, then `#general`, then the first row, so a member
 * who was reading `#social` can be sent to `#general` by a plain reload, and a
 * deep link can name a third. Keeping the few most recent tails means the
 * cache is warm for whichever of those the shell picks, without this module
 * having to know the selection rule (and without changing it).
 */
export const FIRST_CHUNK_CHANNEL_LIMIT = 3;

/**
 * How old a row may be and still paint.
 *
 * The reconciling fetch makes any age *correct* eventually, so this is not
 * about staleness — it is about what a member sees for the few hundred
 * milliseconds before it lands. A week-old timeline painting as real is a lie
 * worth avoiding, and an abandoned profile stops holding chat content on disk
 * indefinitely.
 */
export const FIRST_CHUNK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The tenant a cached row belongs to. Both halves are required; see the header. */
export interface FirstChunkScope {
  /** Supabase auth uid (JWT subject) — not `users.id`. */
  userId: string;
  chapterId: string;
}

export interface CachedChannelListRow extends FirstChunkScope {
  channels: ChatChannel[];
  cachedAt: number;
}

export interface CachedChannelTailRow extends FirstChunkScope {
  channelId: string;
  rows: RawChatMessage[];
  cachedAt: number;
}

class ChatReadCacheDB extends Dexie {
  channelLists!: Table<CachedChannelListRow, [string, string]>;
  channelTails!: Table<CachedChannelTailRow, [string, string, string]>;

  constructor() {
    super(FIRST_CHUNK_DB_NAME);
    /*
      Compound primary keys rather than a `${userId}:${chapterId}` string.

      The scope is the security boundary (see the header), so it is spelled as
      structure the database enforces rather than as a delimiter convention a
      future writer could forget or a value could contain. `[userId+chapterId]`
      is also a usable prefix index on `channelTails`, which is how a scope's
      tails are read and pruned without scanning.
    */
    this.version(1).stores({
      channelLists: "[userId+chapterId]",
      channelTails: "[userId+chapterId+channelId], [userId+chapterId], cachedAt",
    });
  }
}

let cached: ChatReadCacheDB | null = null;

/**
 * Lazy singleton. `null` on the server, and `null` rather than a throw when the
 * constructor fails — the callers below all treat that as "no cache", which is
 * an ordinary cold load.
 *
 * Safe to hold across a {@link wipeFirstChunkCache}: deleting the database
 * fires `versionchange`, Dexie closes on it, and the next operation reopens and
 * recreates the schema.
 */
function openDb(): ChatReadCacheDB | null {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return null;
  }
  if (!cached) {
    try {
      cached = new ChatReadCacheDB();
    } catch {
      return null;
    }
  }
  return cached;
}

/**
 * Test seam: closes and drops the memoized handle.
 *
 * Closing matters as much as dropping. An open connection makes
 * `indexedDB.deleteDatabase` block rather than delete, so a spec that reset the
 * handle without closing would leave the previous test's rows in place and the
 * next assertion would be about the wrong database.
 */
export function resetFirstChunkCacheForTests(): void {
  cached?.close();
  cached = null;
}

/**
 * `cachedAt` is **when the server produced this data**, not when it was written
 * to disk — callers pass the query's `dataUpdatedAt`.
 *
 * The difference is the whole of {@link FIRST_CHUNK_MAX_AGE_MS}. Seeding a row
 * back into the `QueryClient` counts as an update, so the persist path writes it
 * out again a moment later; if the write stamped `Date.now()`, every cold load
 * would renew the age of the rows it had just read. A member opening the
 * dashboard offline once a week would then see a timeline age indefinitely
 * while always reading as fresh, and nothing here could ever expire. Carrying
 * the origin time through means a re-write of unchanged rows preserves their
 * age and only a real fetch resets it.
 */
function isFresh(row: { cachedAt: number }, now: number): boolean {
  return now - row.cachedAt <= FIRST_CHUNK_MAX_AGE_MS;
}

export interface FirstChunk {
  /** `null` when nothing usable was cached — not `[]`, which is a real empty chapter. */
  channels: CachedChannelListRow | null;
  tails: CachedChannelTailRow[];
}

const EMPTY_CHUNK: FirstChunk = { channels: null, tails: [] };

/**
 * Everything cached for one scope, already filtered by age.
 *
 * Reads both tables in one pass so a cold load pays a single IndexedDB round
 * trip rather than one per channel.
 */
export async function readFirstChunk(
  scope: FirstChunkScope,
): Promise<FirstChunk> {
  const db = openDb();
  if (!db) return EMPTY_CHUNK;
  const key = [scope.userId, scope.chapterId];
  try {
    const [list, tails] = await Promise.all([
      db.channelLists.get(key as [string, string]),
      db.channelTails.where("[userId+chapterId]").equals(key).toArray(),
    ]);
    const now = Date.now();
    const usableList =
      list && isFresh(list, now) && list.channels.length > 0 ? list : null;
    /*
      A tail is only served when this scope's own channel list vouches for its
      channel. The compound key is what makes a cross-tenant read impossible;
      this is the cheap consistency check on top of it, so a tail that somehow
      reached the wrong key — a future call site that persists without going
      through `usePersistUnderScope`, say — is not painted as this tenant's.
      With no usable list there is nothing to vouch, and nothing is served.
    */
    const known = new Set(usableList?.channels.map((channel) => channel.id));
    return {
      channels: usableList,
      tails: tails.filter(
        (row) =>
          isFresh(row, now) && row.rows.length > 0 && known.has(row.channelId),
      ),
    };
  } catch {
    return EMPTY_CHUNK;
  }
}

/**
 * Replace the cached channel list for a scope.
 *
 * An empty list is a delete rather than a write: seeding `[]` would move
 * `chat-shell.tsx`'s `channelsPaneState` straight to `empty`/`no-chapter` —
 * a terminal explanation — over the top of a load that is still in flight.
 */
export async function writeChannelList(
  scope: FirstChunkScope,
  channels: ChatChannel[],
  cachedAt: number,
): Promise<void> {
  const db = openDb();
  if (!db) return;
  try {
    if (channels.length === 0) {
      await db.channelLists.delete([scope.userId, scope.chapterId]);
      return;
    }
    await db.channelLists.put({ ...scope, channels, cachedAt });
  } catch {
    /* Best-effort: a failed write costs one cold load, not a broken shell. */
  }
}

/**
 * Replace one channel's tail, then hold the table to
 * {@link FIRST_CHUNK_CHANNEL_LIMIT} rows per scope, oldest first.
 */
export async function writeChannelTail(
  scope: FirstChunkScope,
  channelId: string,
  messages: ChatMessage[],
  cachedAt: number,
): Promise<void> {
  const db = openDb();
  if (!db) return;
  const rows = toCacheableRows(messages);
  try {
    /*
      Nothing cacheable is a reason to skip, never to delete.

      An offline member whose timeline holds only queued outbox rows lands here
      with `rows` empty — and deleting would destroy the very tail their next
      cold load needs, in the one situation where no fetch is coming to rebuild
      it. `writeChannelList` deletes on empty because an empty channel list is
      a real, paintable state that must not be seeded; an empty tail is just an
      absence of news.
    */
    if (rows.length === 0) return;
    await db.channelTails.put({ ...scope, channelId, rows, cachedAt });
    await evictOldestTails(db, scope);
  } catch {
    /* Best-effort — see `writeChannelList`. */
  }
}

async function evictOldestTails(
  db: ChatReadCacheDB,
  scope: FirstChunkScope,
): Promise<void> {
  const key = [scope.userId, scope.chapterId];
  const [tails, list] = await Promise.all([
    db.channelTails.where("[userId+chapterId]").equals(key).toArray(),
    db.channelLists.get(key as [string, string]),
  ]);
  if (tails.length <= FIRST_CHUNK_CHANNEL_LIMIT) return;
  /*
    Recency alone would evict the channel a cold load actually lands on.

    The shell's default is fixed (`#general`, else the first row), not
    most-recent — so a member who reads `#general` and then three other
    channels makes `#general` the oldest tail and loses it, and their next
    reload goes straight to the one channel with nothing cached. Pinning it
    costs one slot and covers the commonest cold load there is.
    `default-channel.ts` holds the rule both sides read.
  */
  const pinned = list ? coldLoadDefaultChannelId(list.channels) : null;
  const evictable = tails
    .filter((row) => row.channelId !== pinned)
    .sort((a, b) => a.cachedAt - b.cachedAt);
  const surplus = tails.length - FIRST_CHUNK_CHANNEL_LIMIT;
  if (surplus <= 0) return;
  await db.channelTails.bulkDelete(
    evictable
      .slice(0, surplus)
      .map(
        (row) =>
          [row.userId, row.chapterId, row.channelId] as [
            string,
            string,
            string,
          ],
      ),
  );
}

/**
 * Delete every row that does not belong to `scope`.
 *
 * This is the backstop half of the wipe pair. `wipeFirstChunkCache` runs the
 * instant an identity changes, but it is asynchronous and un-awaited, and
 * several things can cut it short or block it: the sign-out and chapter-switch
 * controls both `window.location.assign` moments later; `/join` and the
 * onboarding wizard change chapter **in place**, with no navigation at all; and
 * a second tab holding the database open makes the delete `blocked`, which
 * `first-chunk-wipe.ts` resolves through rather than waiting on. This runs on
 * the next read instead and enforces the same rule: one scope's rows at a time,
 * so an identity change whose delete never landed still leaves nothing behind
 * the next time the surface opens.
 *
 * Two limits worth naming rather than implying away. It only runs where
 * `ChatProvider` mounts — `/chat` — so a member who signs out and whose delete
 * was blocked leaves rows on disk until someone opens chat again. And a second
 * tab still on the outgoing chapter keeps writing that chapter's rows through
 * its own open connection, which this deletes and that tab recreates. Neither
 * is a cross-tenant *read* — the keys rule that out — but both are cases where
 * "nothing is left behind" is weaker than it sounds.
 *
 * A member who alternates between two chapters therefore pays a cold load on
 * each swap. That is the trade `1s` and `multi-tenancy.md` both ask for —
 * a chapter switch drops the outgoing chapter's data — and it is the
 * conservative side of a tenancy decision.
 *
 * **Reads primary keys, never rows.** The question is entirely about the key —
 * both tables lead with `[userId+chapterId]` — and `toArray()` would
 * structured-clone every cached message in the database, foreign ones included,
 * to answer it. It also runs *after* the seed rather than in front of it: a
 * read can only reach the current scope's keys, so nothing here protects the
 * paint, and blocking the paint on hygiene would spend the milliseconds this
 * whole module exists to save.
 *
 * Age is not this function's job. `readFirstChunk` already refuses a row past
 * {@link FIRST_CHUNK_MAX_AGE_MS}, and the bounds keep one list plus at most
 * {@link FIRST_CHUNK_CHANNEL_LIMIT} tails per scope, so an expired row is
 * overwritten rather than accumulating.
 */
export async function pruneForeignScopes(
  scope: FirstChunkScope,
): Promise<void> {
  const db = openDb();
  if (!db) return;
  const foreign = (key: readonly unknown[]) =>
    key[0] !== scope.userId || key[1] !== scope.chapterId;
  try {
    const [listKeys, tailKeys] = await Promise.all([
      db.channelLists.toCollection().primaryKeys(),
      db.channelTails.toCollection().primaryKeys(),
    ]);
    await Promise.all([
      db.channelLists.bulkDelete(listKeys.filter(foreign)),
      db.channelTails.bulkDelete(tailKeys.filter(foreign)),
    ]);
  } catch {
    /* Best-effort — see `writeChannelList`. */
  }
}

/**
 * The confirmed tail of a timeline, in the wire shape, newest {@link
 * FIRST_CHUNK_MESSAGE_LIMIT} rows.
 *
 * Only `confirmed` rows survive the filter. Every other `_status` is the
 * outbox's to replay (`pending`, `failed`, `unconfirmed`) or a locally
 * persisted notice's (`recorded`, `recorded-notices.ts`), and both of those
 * sources run on top of whatever this seeds — so a copy here would be a
 * second, staler writer for a row somebody else owns.
 *
 * Exported for the spec, which asserts the round trip through
 * `normalizeRow` rather than trusting this list of fields to stay in step.
 */
export function toCacheableRows(messages: ChatMessage[]): RawChatMessage[] {
  return messages
    .filter((message) => message._status === "confirmed")
    .slice(-FIRST_CHUNK_MESSAGE_LIMIT)
    .map(toRawRow);
}
