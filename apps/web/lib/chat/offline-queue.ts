"use client";

/**
 * Dexie-backed offline persistence for the chat composer — the **outbound**
 * half of chat's on-disk state.
 *
 * Two tables:
 *   - `drafts`     — one row per member per channel, persisted as they type.
 *   - `outbox`     — queued messages awaiting a successful POST to the NestJS
 *                    chat send endpoint.
 *
 * The hot path uses these so:
 *   - drafts survive a tab reload while a user is mid-compose,
 *   - messages composed while offline are kept and flushed in order on
 *     reconnect, and
 *   - a `4xx` failure surfaces inline with a Retry button rather than being
 *     silently lost.
 *
 * `clientId` (a UUID generated client-side and persisted here) doubles as the
 * `chat_messages.client_message_id`, which `ChatService.sendMessage` dedupes on — so
 * retries are idempotent end-to-end.
 *
 * ## Every row is scoped, and the scope is the primary key (#2226)
 *
 * Until #2226 both tables were keyed on the channel and the client id alone.
 * Nothing in them recorded *whose* work they were, and nothing cleared them on
 * sign-out, so on a shared browser they outlived the member who wrote them:
 * member A composed offline, closed the tab with rows still queued, member B
 * signed in, and `ChatProvider`'s boot flush sent A's messages under B's token.
 * The server attributed them to B, and `client_message_id` dedupe did not help —
 * it was the same row being sent for the first time, by the wrong person.
 *
 * The fix is the one `first-chunk-cache.ts` already makes for the inbound read
 * cache, and for the same reason: **keying is the security boundary, not the
 * wipe** (`spec/ui/resilience/caching.md`). Every row carries the scope it was
 * written under as part of its *primary key*, so a row belonging to another
 * member is not merely filtered out of `listQueued` — there is no key under
 * which it can be read, dequeued, or marked failed. {@link
 * createDexieOutboxStore} then binds a store to one scope, so the flush loop in
 * `@repo/chat-core`'s `flushOutbox` cannot address anything else even if it
 * tried.
 *
 * `userId` here is the **Supabase auth uid** (the JWT subject), not `users.id` /
 * `useViewerUserId` — the same choice `first-chunk-cache.ts` documents at
 * length. Briefly: the auth uid is the subject of the token the flush POSTs
 * under, so "rows this scope can see" and "rows this token may author" are the
 * same set by construction; and it is readable from the local session, whereas
 * `users.id` costs a `GET /v1/users/me` round trip that an offline composer
 * does not have.
 *
 * ### Why the outbox carries `chapterId` and drafts do not
 *
 * Not symmetry for its own sake. A channel id is a UUID unique across chapters,
 * so `[userId+channelId]` already isolates a draft completely and a chapter
 * segment would be redundant structure — and `useChannelDraft` would have to
 * thread a chapter it never otherwise needs.
 *
 * The outbox is different, because a flush is a *send* and sends carry the
 * active chapter in a header. `ChatService.sendMessage` runs
 * `assertChannelAccess(channel_id, chapter_id, …)`, so a row queued in chapter 1
 * and flushed while the client is on chapter 2 is rejected 4xx, marked `failed`,
 * and shown to the member as a message that would not send — a legitimate
 * message burned by a chapter switch. Scoping the queue by chapter means those
 * rows are simply not visible to that flush; they stay queued and go out when
 * the member is back in the chapter they were written for.
 *
 * ## What this database deliberately does NOT do
 *
 * It is not wiped on an identity change, and `frapp-client-provider.tsx` must
 * not start wiping it. That is the whole reason the first-chunk read cache
 * lives in a *separate* IndexedDB database (see `first-chunk-wipe.ts`): the rows
 * here are outbound work the member has not sent yet, and deleting them is the
 * one thing `spec/ui/resilience/principles.md` §5 says never to do. A
 * `pruneForeignScopes`-style sweep would be the same deletion wearing a
 * different name — every row belonging to the member who just signed out is
 * "foreign" to the member who just signed in. So A's unsent messages wait for
 * A's next sign-in on this browser, which the scoped keys make safe.
 *
 * The cost of that choice, stated plainly: an abandoned profile keeps one
 * member's unsent text on disk indefinitely. Bounding that by age is real work
 * with its own data-loss decision and is not #2226's.
 */

import Dexie, { type Table } from "dexie";
// Row shapes are canonical on the `@repo/chat-core/adapters` port (OutboxStore).
import type {
  NewOutboxRow,
  OutboxRow,
  OutboxStore,
} from "@repo/chat-core/adapters";
// The tenant scope has one home, shared with the first-chunk read cache.
import type { ChatDraftScope, ChatScope } from "./chat-scope";

/** The IndexedDB database holding drafts and the outbox, and only those. */
export const CHAT_OUTBOUND_DB_NAME = "frapp-chat";

export interface DraftRow {
  userId: string;
  channelId: string;
  body: string;
  updatedAt: number;
}

/**
 * An outbox row as it sits on disk: the port's row plus the scope its key is
 * built from. The scope is stripped again on the way out — {@link toPortRow} —
 * so no caller can come to depend on a field the `OutboxStore` port does not
 * promise.
 */
interface StoredOutboxRow extends OutboxRow, ChatScope {}

class ChatDB extends Dexie {
  drafts!: Table<DraftRow, [string, string]>;
  outbox!: Table<StoredOutboxRow, [string, string, string]>;

  constructor() {
    super(CHAT_OUTBOUND_DB_NAME);
    /*
      v1 — the unscoped schema #2226 replaced. Kept declared so the upgrade
      path below reads as the history it is.
    */
    this.version(1).stores({
      drafts: "channelId, updatedAt",
      outbox: "clientId, channelId, queuedAt, status",
    });
    /*
      v2 — drop both tables. v3 recreates them.

      This is two versions rather than one because IndexedDB object-store key
      paths are immutable and Dexie says so out loud: declaring the new primary
      key directly on top of v1 fails the upgrade with `UpgradeError: Not yet
      support for changing primary key`, which would leave chat unable to open
      its database at all on every browser that has ever run the old build.
      Dropping the store and recreating it is the supported route, and it is
      also exactly the migration we want.

      **This deletes existing drafts and queued messages, and that is
      deliberate.** A v1 row records no member, so there is no user to migrate
      it to — and assigning it to whoever opens the database next would *be*
      the cross-account authorship bug #2226 exists to close, performed by the
      migration instead of by the flush. The alternative, quarantining the rows
      somewhere nothing reads, is the same loss with more moving parts.

      Who this actually costs: a member with unsent work in `frapp-chat` at the
      moment they first load the build carrying this change. A queued row only
      survives that long if it was composed offline and the tab never
      reconnected — an online send POSTs and dequeues immediately. Drafts are
      the commoner loss and the cheaper one.
    */
    this.version(2).stores({ drafts: null, outbox: null });
    /*
      v3 — the scoped schema. Compound primary keys rather than a
      `${userId}:${channelId}` string, following `first-chunk-cache.ts`: the
      scope is the security boundary, so it is spelled as structure the
      database enforces rather than as a delimiter convention a future writer
      could forget or a value could contain.

      The only secondary indexes are the two reads the flush path makes —
      `listQueued` (this scope's queued rows) and `listForChannel` (this
      scope's rows for one channel) — so neither has to scan. `drafts` declares
      none at all: every access it has is a `get`/`put`/`delete` on the primary
      key. An index nothing queries is not free — it is rewritten on every
      keystroke's `put` and every send's `enqueue` — so `queuedAt` is absent
      too: both list reads materialise a scope's rows and then `sortBy`, which
      is Dexie's in-memory sort and consults no index.
    */
    this.version(3).stores({
      drafts: "[userId+channelId]",
      outbox:
        "[userId+chapterId+clientId], [userId+chapterId+status], [userId+chapterId+channelId]",
    });
  }
}

let cached: ChatDB | null = null;

/**
 * Lazy singleton — `new Dexie()` opens an IndexedDB connection, which we can't
 * do during SSR. Server-side callers get `null`, and so does a browser whose
 * constructor throws (IndexedDB disabled, private mode); every caller below
 * treats that as "no persistence", which is the degradation `use-channel-draft.ts`
 * has always assumed.
 *
 * **Module-private, and that is load-bearing.** The scoped keys are the tenant
 * boundary, but they only bind callers who go through the scoped helpers above
 * and {@link createDexieOutboxStore}. An exported handle is an unscoped
 * `db.outbox.toArray()` that any `apps/web` module could reach for, compiling
 * clean and drawing no lint objection — the pre-#2226 shape, one import away.
 */
function getChatDB(): ChatDB | null {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return null;
  }
  if (!cached) {
    try {
      cached = new ChatDB();
    } catch {
      return null;
    }
  }
  return cached;
}

/**
 * Test seam: closes and drops the memoized handle.
 *
 * Closing matters as much as dropping — an open connection makes a delete or an
 * upgrade `blocked` rather than run, so a spec that reset the handle without
 * closing would be asserting against the previous test's database.
 */
export function resetChatDBForTests(): void {
  cached?.close();
  cached = null;
}

/**
 * Drop the scope fields the port does not promise.
 *
 * Spelled as a copy-and-delete rather than a rest destructure so the discarded
 * halves do not have to be bound to names nothing reads — and so adding a field
 * to `OutboxRow` needs no change here.
 */
function toPortRow(row: StoredOutboxRow): OutboxRow {
  const port: OutboxRow & Partial<ChatScope> = { ...row };
  delete port.userId;
  delete port.chapterId;
  return port;
}

export async function saveDraft(
  scope: ChatDraftScope,
  channelId: string,
  body: string,
): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  if (body.length === 0) {
    await db.drafts.delete([scope.userId, channelId]);
    return;
  }
  await db.drafts.put({
    userId: scope.userId,
    channelId,
    body,
    updatedAt: Date.now(),
  });
}

export async function loadDraft(
  scope: ChatDraftScope,
  channelId: string,
): Promise<string> {
  const db = getChatDB();
  if (!db) return "";
  const row = await db.drafts.get([scope.userId, channelId]);
  return row?.body ?? "";
}

export async function clearDraft(
  scope: ChatDraftScope,
  channelId: string,
): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  await db.drafts.delete([scope.userId, channelId]);
}

/**
 * One scope's outbox: the `@repo/chat-core` port, plus the single-row read the
 * Retry and Discard controls need.
 *
 * `get` rides here rather than staying a free function taking a scope, so there
 * is exactly one place a scope is bound to a queue. A caller holding both a
 * store and a loose scope could bind them to different members; holding only
 * the store, it cannot.
 */
export type ChatOutbox = OutboxStore & {
  get(clientId: string): Promise<OutboxRow | undefined>;
};

/**
 * The store used when there is no scope to key rows under: keeps nothing, reads
 * nothing, and **fails an enqueue rather than pretending to have kept it**.
 *
 * That last part is the whole difference between this and the no-IndexedDB
 * path, which returns the row and degrades silently. A browser with storage
 * switched off is a permanent, known condition where an online send still
 * works and the member has been living without persistence all along. A missing
 * scope is not: `sendMessage` takes the returned row as proof the message is
 * durably queued, so answering while writing nothing means an offline compose
 * is lost on reload with no error, no Retry and no Discard — the exact failure
 * `packages/chat-core/src/adapters.ts` says this port exists to make
 * impossible. `sendMessage` already handles a throwing `enqueue`: it removes
 * the optimistic card rather than leaving a phantom (#1718), so the member is
 * told, and nothing is silently swallowed.
 *
 * Reaching this at all is narrow, and narrower than it was. `userId` comes from
 * {@link useChatOutboundScope}, which is sticky and survives the token expiry
 * and the remount that used to empty it; and `sendMessage` returns on
 * `!ctx.userId` before it ever reaches `enqueue`. What is left is a member with
 * **no active chapter** who still has a channel id — a deep link, since a
 * channel list needs the chapter — and such a send cannot succeed anyway:
 * `ChatService.sendMessage` checks the chapter header against the channel, so
 * there is nothing here to lose by refusing loudly.
 */
const INERT_OUTBOX: ChatOutbox = {
  async enqueue(): Promise<OutboxRow> {
    throw new Error(
      "chat outbox has no scope to queue under (no signed-in member or no active chapter)",
    );
  },
  async dequeue(): Promise<void> {},
  async requeue(): Promise<void> {},
  async markFailed(): Promise<void> {},
  async bumpAttempt(): Promise<void> {},
  async listQueued(): Promise<OutboxRow[]> {
    return [];
  },
  async listForChannel(): Promise<OutboxRow[]> {
    return [];
  },
  async clearDraft(): Promise<void> {},
  async get(): Promise<OutboxRow | undefined> {
    return undefined;
  },
};

/**
 * The web `OutboxStore`, bound to one scope.
 *
 * A factory rather than the module const it used to be, and that is the point:
 * the store a `ChatActionContext` carries can only ever address the rows of the
 * member and chapter it was built for, so `flushOutbox` — which iterates
 * whatever `listQueued` hands back — has no way to reach another member's
 * queue. `apps/mobile/lib/chat/outbox-store.ts` is already shaped this way.
 *
 * A `null` scope returns {@link INERT_OUTBOX} rather than a store that
 * re-checks for one on every call; deciding once is what lets the real store
 * below treat `scope` as present rather than asserting it is at every key it
 * builds.
 *
 * **What an unscoped window costs, stated rather than argued away.** While the
 * scope is missing — first paint before the session resolves, or a member with
 * no active chapter — nothing is written to disk. That is deliberate: there is
 * no correct key for the row, and inventing one is the cross-account bug this
 * whole module exists to close. It is also *exactly* the degradation a browser
 * with IndexedDB disabled has always had, and it degrades the same way: an
 * online send still POSTs and still succeeds, because the queue is only load-
 * bearing for offline and retry. The residue is narrow and real — a message
 * composed **offline** inside that window is not durable, and its `markFailed`
 * is a no-op too, so it does not come back on reload.
 *
 * An earlier draft of this comment asserted the window was unreachable, on the
 * grounds that a send needs `ctx.userId` and a channel id. Neither support
 * holds: `useViewerUserId` reads `["user","me"]`, which `use-auth-user-id.ts`
 * records as *not* account-scoped, and `chat-page.tsx` takes a channel id
 * straight off `?channel=` without consulting the chapter. Nothing enforces the
 * invariant, so it is not claimed.
 */
export function createDexieOutboxStore(scope: ChatScope | null): ChatOutbox {
  if (!scope) return INERT_OUTBOX;

  const key = (clientId: string): [string, string, string] => [
    scope.userId,
    scope.chapterId,
    clientId,
  ];

  /** Read-modify-write on one of this scope's rows; a no-op if it is not ours. */
  async function patch(
    clientId: string,
    change: (row: StoredOutboxRow) => StoredOutboxRow,
  ): Promise<void> {
    const db = getChatDB();
    if (!db) return;
    const existing = await db.outbox.get(key(clientId));
    if (!existing) return;
    await db.outbox.put(change(existing));
  }

  return {
    async enqueue(row: NewOutboxRow): Promise<OutboxRow> {
      const full: OutboxRow = {
        attempts: 0,
        status: "queued",
        queuedAt: Date.now(),
        ...row,
      };
      const db = getChatDB();
      if (!db) return full;
      await db.outbox.put({ ...full, ...scope });
      return full;
    },

    async dequeue(clientId: string): Promise<void> {
      const db = getChatDB();
      if (!db) return;
      await db.outbox.delete(key(clientId));
    },

    async requeue(clientId: string): Promise<void> {
      await patch(clientId, (row) => ({
        ...row,
        status: "queued",
        lastError: undefined,
      }));
    },

    async markFailed(clientId: string, error: string): Promise<void> {
      await patch(clientId, (row) => ({
        ...row,
        status: "failed",
        attempts: row.attempts + 1,
        lastError: error,
      }));
    },

    async bumpAttempt(clientId: string, error: string): Promise<void> {
      await patch(clientId, (row) => ({
        ...row,
        attempts: row.attempts + 1,
        lastError: error,
      }));
    },

    /** This scope's queued rows, FIFO — drives the in-order flush loop. */
    async listQueued(): Promise<OutboxRow[]> {
      const db = getChatDB();
      if (!db) return [];
      const rows = await db.outbox
        .where("[userId+chapterId+status]")
        .equals([scope.userId, scope.chapterId, "queued"])
        .sortBy("queuedAt");
      return rows.map(toPortRow);
    },

    /** This scope's rows for a channel (queued + failed), to hydrate the cache on boot. */
    async listForChannel(channelId: string): Promise<OutboxRow[]> {
      const db = getChatDB();
      if (!db) return [];
      const rows = await db.outbox
        .where("[userId+chapterId+channelId]")
        .equals([scope.userId, scope.chapterId, channelId])
        .sortBy("queuedAt");
      return rows.map(toPortRow);
    },

    async clearDraft(channelId: string): Promise<void> {
      await clearDraft(scope, channelId);
    },

    /** One of this scope's rows, for the Retry / Discard controls. */
    async get(clientId: string): Promise<OutboxRow | undefined> {
      const db = getChatDB();
      if (!db) return undefined;
      const row = await db.outbox.get(key(clientId));
      return row ? toPortRow(row) : undefined;
    },
  };
}
