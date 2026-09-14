"use client";

/**
 * Deleting the chat first-chunk read cache — and nothing else in this file.
 *
 * ## Why this is its own module
 *
 * The wipe has to be reachable from `lib/providers/frapp-client-provider.tsx`,
 * which is on the **shell path**: every dashboard route pays for whatever it
 * imports. `first-chunk-cache.ts` imports Dexie, and Dexie is currently in the
 * chat chunk only (`offline-queue.ts` is its one other importer). A static
 * import of the cache module from the provider would move Dexie onto the shell
 * floor `spec/ui/resilience/performance-budgets.md` measures — a regression on
 * `/settings`, `/points`, and every other route, to pay for a function that
 * runs at most twice in a session.
 *
 * So the wipe is spelled against the raw `indexedDB` API instead, with no
 * imports at all, and `first-chunk-cache.ts` takes the database name from
 * here rather than the other way round.
 *
 * ## Why a whole database, not a `clear()` per table
 *
 * The read cache is the only thing in `FIRST_CHUNK_DB_NAME`. Drafts and the
 * outbox live in `frapp-chat` (`offline-queue.ts`) and are outbound work the
 * member has not sent yet — deleting those on an identity change would throw
 * away messages, which is the one thing `spec/ui/resilience/principles.md`
 * says never to do. Keeping the inbound cache in its own database makes
 * "drop every cached row and none of the queued ones" a single call that
 * cannot be got wrong by enumerating tables, which is the same argument
 * `frapp-client-provider.tsx` makes for clearing the whole `QueryClient`
 * rather than a list of keys.
 *
 * That those tables are *not* dropped is now a settled decision rather than
 * merely today's behaviour. [#2226](https://github.com/pdcarlson/Frapp/issues/2226)
 * closed the tenancy hole they used to have by **re-keying** them —
 * `[userId+channelId]` for drafts, `[userId+chapterId+clientId]` for the
 * outbox — so another member can no longer read a draft or flush a queued
 * message, while the rows survive for the member who actually wrote them.
 * This wipe must therefore keep its hands off `frapp-chat`: a sweep of that
 * database on an identity change would be the message deletion the re-key
 * exists to avoid.
 */

/** The IndexedDB database holding the first-chunk read cache, and only that. */
export const FIRST_CHUNK_DB_NAME = "frapp-chat-read-cache";

/**
 * Delete the read cache outright.
 *
 * Never rejects: a browser with IndexedDB disabled, a private window, or a
 * blocked delete must not be able to fail the identity change that called it.
 *
 * Resolves on `blocked` as well as on success. `blocked` means another holder
 * of this database has not closed yet — in practice a second tab, since Dexie
 * closes its own connection on the `versionchange` this fires. The delete stays
 * queued and completes when that holder goes away; resolving here only means no
 * caller waits on another tab's lifetime. Production callers do not await this
 * at all, and the read path re-checks scope on every read, so a delete that
 * lands late is still correct — see `pruneForeignScopes` in
 * `first-chunk-cache.ts`, which is the guaranteed half of this pair.
 */
export function wipeFirstChunkCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(FIRST_CHUNK_DB_NAME);
    } catch {
      resolve();
      return;
    }
    const done = () => resolve();
    request.onsuccess = done;
    request.onerror = done;
    request.onblocked = done;
  });
}
