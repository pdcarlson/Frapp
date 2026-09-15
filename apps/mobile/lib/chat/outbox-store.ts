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
 * update — and the flush loop plus a user send can genuinely overlap. That
 * invariant is **per storage key, not per store object**, which is why
 * {@link getOutboxStore} memoizes: two live stores over one key would each have
 * their own chain and the guarantee would quietly evaporate.
 *
 * ## Every key carries the member who wrote it (#2228)
 *
 * Until #2228 the queue lived at one process-wide `chat:outbox:v1` and drafts
 * at `chat:draft:<channelId>`, neither recording who wrote them, and nothing
 * cleared them at the account boundary. On a shared or handed-over phone that
 * is a cross-account authorship bug: A composes offline and signs out with rows
 * still queued, B signs in, the boot `flushOutbox` reads the same global key,
 * and A's rows POST under B's bearer token. `client_message_id` dedupe does not
 * help — it is the same row being sent for the first time, by the wrong person.
 * B's composer also opened showing A's draft text.
 *
 * The fix mirrors web's #2226: **keying is the security boundary, not the
 * wipe** (`spec/ui/resilience/caching.md`). AsyncStorage has no compound keys,
 * so the scope is spelled into the key string. A store bound to B has no key
 * under which it can read, flush, dequeue, mark-failed or requeue a row A
 * wrote — it is not filtered out, it is unreachable.
 *
 * Deliberately *not* a wipe on identity change: a queued row is a message the
 * member composed and has not sent, so deleting it on sign-out is precisely
 * what `spec/ui/resilience/principles.md` §5 forbids. Scoped keys are what make
 * keeping it safe — A's unsent work waits for A's next sign-in on this device
 * and is unreadable by anyone else meanwhile.
 *
 * The key carries the member and **not** the chapter, unlike web's. `chat-scope.ts`
 * has that argument in full; the short version is that mobile's chapter comes
 * from a claim the rest of the stack treats as optional, so keying on it would
 * turn a missing claim into a total send outage — and it would not buy the
 * cross-chapter protection anyway, because the chapter can move under an
 * in-flight flush.
 *
 * ## Pre-#2228 rows are left alone
 *
 * They are unreachable the moment these keys land, so nothing has to be deleted
 * for the boundary to hold. Deleting them would be the one thing §5 forbids —
 * they are composed-but-unsent messages, and on a *phone* (unlike a shared
 * browser) they were almost certainly written by the member still holding it.
 * So they are simply never read again. The `chat:v2:` prefixes below are
 * deliberately chosen not to nest under the old `chat:outbox:` / `chat:draft:`
 * namespaces, so a future sweep that wants them can match the old prefixes
 * without any risk of matching a live key.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  NewOutboxRow,
  OutboxRow,
  OutboxStore,
} from "@repo/chat-core/adapters";

import type { ChatScope } from "./chat-scope";

/**
 * Note the shape: `chat:v2:outbox:` rather than `chat:outbox:v2:`.
 *
 * The version segment leads so that neither live namespace is a suffix-extension
 * of a pre-#2228 one. `"chat:outbox:v2:…".startsWith("chat:outbox:")` would have
 * been true, which makes the obvious legacy-cleanup sweep — filter `getAllKeys`
 * by the old prefix — delete every live row instead.
 */
const OUTBOX_PREFIX = "chat:v2:outbox:";
const DRAFT_PREFIX = "chat:v2:draft:";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

/** The single key this member's queue lives under. */
export function outboxKey(scope: ChatScope): string {
  return `${OUTBOX_PREFIX}${scope.userId}`;
}

/**
 * The key one channel's draft lives under for this member.
 *
 * Shared with `draft-store.ts`, which writes the key this store's `clearDraft`
 * removes. If the two ever disagree, a sent message leaves its draft behind and
 * the composer refills with text the member already sent — so they derive it
 * from one function rather than two matching string literals.
 */
export function draftKey(scope: ChatScope, channelId: string): string {
  return `${DRAFT_PREFIX}${scope.userId}:${channelId}`;
}

/**
 * Thrown by `enqueue` when there is no member to key the row to.
 *
 * The message is member-facing on purpose: `use-chat-channel.ts` renders
 * `error.message` straight into the composer hint, because mobile has no toast.
 * The diagnostic belongs here in the comment rather than in the string — this
 * can only happen when nobody is, or has been, signed in during this process,
 * which for a chat surface means the session went away underneath it.
 *
 * Failing loudly is still the point. Returning a row that was never written
 * reports a queued message to `sendMessage` that does not exist, which is the
 * silent loss the outbox exists to prevent — so this surfaces as a failed send
 * the member can see and retry once signed in again.
 */
export class UnscopedOutboxError extends Error {
  constructor() {
    super("You're signed out. Sign in again to send this message.");
    this.name = "UnscopedOutboxError";
  }
}

/**
 * The store handed out when there is no member.
 *
 * One object stating the unscoped semantics once, so every method in the real
 * factory below may assume a scope is present. Web reached the same shape from
 * the same pressure (`offline-queue.ts`'s `INERT_OUTBOX`): scattering a
 * `if (!scope)` branch through six methods is how the seventh gets forgotten,
 * and a missed guard there builds a key like `chat:v2:outbox:undefined` — one
 * shared bucket every unscoped device reads and writes, which is #2228 exactly.
 */
const INERT_OUTBOX: OutboxStore = {
  enqueue: () => Promise.reject(new UnscopedOutboxError()),
  dequeue: () => Promise.resolve(),
  requeue: () => Promise.resolve(),
  markFailed: () => Promise.resolve(),
  bumpAttempt: () => Promise.resolve(),
  listQueued: () => Promise.resolve([]),
  listForChannel: () => Promise.resolve([]),
  clearDraft: () => Promise.resolve(),
};

export function createAsyncStorageOutboxStore(
  scope: ChatScope | null,
  storage: Storage = AsyncStorage,
  now: () => number = Date.now,
): OutboxStore {
  if (!scope) return INERT_OUTBOX;

  const key = outboxKey(scope);
  /** Serializes read-modify-write cycles; see the module comment. */
  let tail: Promise<unknown> = Promise.resolve();

  async function readAll(): Promise<OutboxRow[]> {
    try {
      const raw = await storage.getItem(key);
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
      await storage.setItem(key, JSON.stringify(rows));
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
        await storage.removeItem(draftKey(scope, channelId));
      } catch {
        // A stale draft is a cosmetic problem; it must not fail the send that
        // triggered the clear.
      }
    },
  };
}

/**
 * One store per member per process.
 *
 * Two things depend on this rather than on a `useMemo`. The serialization chain
 * above is only a guarantee while one chain owns one key, and React treats a
 * `useMemo` as a cache it may discard — so a remount, a concurrent re-render,
 * or simply a second `useChatRuntime()` caller could otherwise put two chains
 * on one key and lose a queued row to an interleaved read-modify-write.
 *
 * It also keeps the store's *identity* stable, which matters upward:
 * `ChatActionContext` holds the store, and `use-chat-channel.ts` keys effects on
 * that context. A store rebuilt on every render would churn them.
 *
 * Unbounded by design — one entry per member who signs in during a process, on
 * a device where that is approximately one.
 */
const stores = new Map<string, OutboxStore>();

/** Test seam — module state outlives a `renderHook`, so specs must reset it. */
export function resetOutboxStoresForTests(): void {
  stores.clear();
}

export function getOutboxStore(scope: ChatScope | null): OutboxStore {
  if (!scope) return INERT_OUTBOX;
  const key = outboxKey(scope);
  let store = stores.get(key);
  if (!store) {
    store = createAsyncStorageOutboxStore(scope);
    stores.set(key, store);
  }
  return store;
}
