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
 * This cache inverts that. It stores three kinds of row, each named explicitly,
 * and every row carries the `userId` + `chapterId` it was written under **as
 * part of its primary key**. A read is a lookup at the current scope, so a row
 * written for another member or another chapter is not merely ignored — there
 * is no key under which it can be returned. That, and not the wipe, is what
 * makes a cross-tenant read impossible; the wipe
 * (`first-chunk-wipe.ts`) and `pruneForeignScopes` below are hygiene on top of
 * it, so a member's rows do not sit on a shared machine after they leave.
 *
 * ## The viewer id row is the sensitive one, and it is named rather than assumed
 *
 * The third row type holds the viewer's **`users.id`** — the id
 * `chat_messages.sender_id` references, and the one that decides which of
 * `components.md` §11's two bubble shapes a row takes. `caching.md`'s argument
 * against `persistQueryClient` names `["user","me"]` specifically as a key that
 * must not outlive a sign-out, so storing anything derived from it has to be
 * justified out loud instead of waved through on the header above.
 *
 * Three things make this row the blessed case rather than that one:
 *
 * - **It is keyed on the auth uid, so it cannot be read back by anyone else.**
 *   A persister restores `["user","me"]` for whoever opens the tab next because
 *   that key carries no identity. This row's key *is* the identity, and the
 *   scope it is read at comes from the live Supabase session — so the only
 *   member who can read member A's `users.id` back is member A.
 * - **It is one opaque id, not the user object.** `["user","me"]` is never
 *   seeded from it (see `use-first-chunk-cache.ts`): that key's consumers —
 *   `account-menu`, `profile-panel`, `billing-page` — read a whole profile, and
 *   a partial one seeded there would be a worse bug than the one this fixes.
 *   Nothing here reaches those surfaces; the id is a paint input for chat.
 * - **It is the id the rows beside it are already attributed with.** It is read
 *   in the same transaction as the tails ({@link readFirstChunk}) precisely so
 *   there is no window in which cached rows are painted and the id that says
 *   whose they are has not arrived — which is the window
 *   [#2243](https://github.com/pdcarlson/Frapp/issues/2243) was a bug in.
 *
 * The scope also carries `chapterId`, which `users.id` does not depend on. That
 * is deliberate rather than sloppy: it costs nothing, because a chapter change
 * drops the query cache wholesale and wipes this database, so the rows this id
 * exists to attribute are gone on exactly the events that would invalidate it —
 * and keying it the same way as everything else means it rides
 * {@link pruneForeignScopes} and the wipe without a second rule to keep right.
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
 * - **The viewer's `users.id`** — one id per scope, so the tails above can be
 *   attributed to a side of the thread without waiting on `GET /v1/users/me`.
 *   See the section above for why this row and not the user object.
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
// Type-only: the shared scope definition, erased at compile time.
import type { ChatScope } from "./chat-scope";

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

/**
 * The tenant a cached row belongs to. Both halves are required; see the header.
 *
 * An alias, not a second declaration: the outbound drafts/outbox database keys
 * its rows on the same scope, and two structurally-identical definitions of a
 * security boundary are two things that can drift. `chat-scope.ts` is its home.
 */
export type FirstChunkScope = ChatScope;

export interface CachedChannelListRow extends FirstChunkScope {
  channels: ChatChannel[];
  cachedAt: number;
}

export interface CachedChannelTailRow extends FirstChunkScope {
  channelId: string;
  rows: RawChatMessage[];
  cachedAt: number;
}

/**
 * The viewer's `users.id` under one scope.
 *
 * Spelled `viewerUserId` rather than reusing `userId`, which this row already
 * has and which means something else: `userId` is the **Supabase auth uid** the
 * row is keyed on, and `viewerUserId` is the **`users.id`** the API answers with
 * and `chat_messages.sender_id` references. Two id spaces in one row is exactly
 * the place a single reused name would eventually be read as the wrong one.
 */
export interface CachedViewerIdRow extends FirstChunkScope {
  viewerUserId: string;
  cachedAt: number;
}

class ChatReadCacheDB extends Dexie {
  channelLists!: Table<CachedChannelListRow, [string, string]>;
  channelTails!: Table<CachedChannelTailRow, [string, string, string]>;
  viewerIds!: Table<CachedViewerIdRow, [string, string]>;

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
    /*
      v2 adds `viewerIds` and changes nothing that exists.

      No `upgrade()` callback, because there is no data to move: a v1 database
      has never held a viewer id, and the absence of the row is exactly the
      state a reader must already handle — it is what every first load looks
      like. Dexie creates the store and leaves the other two alone, so a member
      mid-session on the old schema keeps their cached rail and tails and simply
      starts caching the id from their next resolve.
    */
    this.version(2).stores({
      viewerIds: "[userId+chapterId]",
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
  /**
   * The viewer's `users.id`, or `null` when this scope has none cached.
   *
   * The whole row, not the bare id: the caller re-checks the scope it was
   * written under against the scope currently in effect before painting
   * anything with it, and it cannot do that with the id alone.
   */
  viewer: CachedViewerIdRow | null;
}

const EMPTY_CHUNK: FirstChunk = { channels: null, tails: [], viewer: null };

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
    /*
      The viewer id is read here, in the same `Promise.all` as the rows, rather
      than from a lookup of its own — and that is a correctness property, not a
      saved round trip.

      It resolves with the tails it exists to attribute. A separate read could
      land after them, and a commit that painted rows before the id said whose
      they were is precisely the window #2243 was a bug in: the rows would take
      the incoming shape, then reflow under the member when the id arrived.
      Read together, they reach React together.
    */
    const [list, tails, viewer] = await Promise.all([
      db.channelLists.get(key as [string, string]),
      db.channelTails.where("[userId+chapterId]").equals(key).toArray(),
      db.viewerIds.get(key as [string, string]),
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
      /*
        Aged like every other row, and deliberately **not** gated on the channel
        list the way a tail is.

        A tail needs the list to vouch for its channel because a channel id is
        the one part of a tail's key this scope does not otherwise attest. The
        viewer id has nothing left to vouch for: its whole key is the scope, and
        the scope is what the read is a lookup at. Requiring a list would also
        withhold the id in the one case it is most needed — a member whose rail
        expired but whose tails are still fresh would paint rows with no side.

        Age still applies. `FIRST_CHUNK_MAX_AGE_MS` bounds the one way this row
        can go stale without the key changing: an account deleted and recreated
        under the same auth uid gets a new `users.id`. The live value overrides
        it within a round trip in any case (`use-first-chunk-cache.ts`), and the
        rows it would mis-attribute in the meantime are that same member's own
        cached history — so the failure mode is "your old messages briefly read
        as someone else's", never "someone else's read as yours".
      */
      viewer: viewer && isFresh(viewer, now) ? viewer : null,
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
 * Remember the viewer's `users.id` for this scope.
 *
 * One row per scope, overwritten each time identity resolves — there is nothing
 * to evict and no list to bound.
 *
 * **Refuses an empty id rather than deleting on one.** `writeChannelList`
 * deletes on an empty array because an empty channel list is a real, paintable
 * state that must not be seeded; there is no such state for an identity. An
 * absent id means "not known", which is what a missing row already says, and a
 * caller that reached here with `""` is a caller whose identity has not
 * resolved — deleting then would throw away a good row on the strength of a
 * value that means nothing.
 */
export async function writeViewerId(
  scope: FirstChunkScope,
  viewerUserId: string,
  cachedAt: number,
): Promise<void> {
  const db = openDb();
  if (!db) return;
  if (!viewerUserId) return;
  try {
    await db.viewerIds.put({ ...scope, viewerUserId, cachedAt });
  } catch {
    /* Best-effort — see `writeChannelList`. */
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
 * every table leads with `[userId+chapterId]` — and `toArray()` would
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
    const [listKeys, tailKeys, viewerKeys] = await Promise.all([
      db.channelLists.toCollection().primaryKeys(),
      db.channelTails.toCollection().primaryKeys(),
      db.viewerIds.toCollection().primaryKeys(),
    ]);
    await Promise.all([
      db.channelLists.bulkDelete(listKeys.filter(foreign)),
      db.channelTails.bulkDelete(tailKeys.filter(foreign)),
      db.viewerIds.bulkDelete(viewerKeys.filter(foreign)),
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
