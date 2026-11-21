import { AsyncLocalStorage } from 'node:async_hooks';
import { InFlightLookups } from './in-flight-lookups';

/**
 * One read per request for the lookups every chat request repeats (#3728).
 *
 * A request's guards read the caller's membership and roles, and the handler's
 * access checks (`ChannelAccessService`, `RbacService`) then read the same
 * rows again, two or three times on a channel list, one after another. On a
 * resume burst every one of those is a round trip to Supabase. Inside one
 * request they now share the first read, and the guards' reads start while
 * the session check is still in flight (`prefetchChapterContext`). The keys
 * are `readMemberByUserAndChapter` and `readRolesByIds` (so every
 * `findByUserAndChapter` / `findByIds` call in the request) and
 * `ChapterGuard`'s user and chapter rows. With a chapter named, the prefetch
 * gets all four from one call (`get_request_context`, #3583): the user and
 * chapter rows through `readOncePerRequest` as before, the membership and
 * roles recorded with `keepForRequest`.
 *
 * **Across requests, only a burst's in-flight reads.** The store is created
 * per request by `requestReadsMiddleware` and dies with it. `GET` and `HEAD`
 * requests that arrive together may also join a membership or role read (and
 * the guards' session and `get_request_context` checks) that another such
 * request started at most `IN_FLIGHT_JOIN_WINDOW_MS` earlier
 * (`sharesBurstLookups`, `readSharedInBurst`), the bound Paul accepted on
 * 2026-11-13 (#3752; `spec/behavior/rbac.md` § Permission Check Algorithm,
 * `spec/behavior/multi-tenancy.md`). A request that may write makes every
 * check itself, so a role change or a removal stops a write at once, and
 * every read that arrives after the window sees it too.
 *
 * **A write's handler reads afresh.** A `GET` or `HEAD` keeps its store to the
 * end. Any other method keeps it only through the guards:
 * `RequestReadsInterceptor` seals it before the handler runs, and from then on
 * every read goes to the database. So a handler that changes a membership or a
 * role and then reads it back is never handed the row as it was before its own
 * write.
 *
 * Code that runs outside a request (workers, crons, tests that build a service
 * by hand) has no store and reads straight through.
 */
const READ_METHODS = new Set(['GET', 'HEAD']);

const burstReads = new InFlightLookups<unknown>();

/**
 * Runs `read`, or joins the same `key`'s read that another request started at
 * most `IN_FLIGHT_JOIN_WINDOW_MS` ago (#3752). Only in a `GET` or `HEAD`
 * request (`sharesBurstLookups`): a request that may write, a worker or a
 * cron reads the database itself. The answer is shared by reference, so call
 * it inside `readOncePerRequest`, which hands each caller a copy.
 */
export function readSharedInBurst<T>(
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  if (!sharesBurstLookups()) return read();
  return burstReads.run(key, read) as Promise<T>;
}

interface RequestReads {
  readonly reads: Map<string, Promise<unknown>>;
  /** True for a method that may write; such a store is sealed at the handler. */
  readonly writes: boolean;
  sealed: boolean;
}

const storage = new AsyncLocalStorage<RequestReads>();

/** Runs `fn` with a fresh store for one request made with `method`. */
export function runWithRequestReads<T>(method: string, fn: () => T): T {
  return storage.run(
    {
      reads: new Map(),
      writes: !READ_METHODS.has(method.toUpperCase()),
      sealed: false,
    },
    fn,
  );
}

/**
 * Called as the handler is about to run. A write request's store stops
 * answering, so the handler's own reads see its own writes.
 */
export function sealRequestReadsForWrites(): void {
  const store = storage.getStore();
  if (store?.writes) store.sealed = true;
}

/**
 * Whether this request may join a lookup another request already started
 * (#3752): only a `GET` or `HEAD` request, inside its store. A request that
 * may write checks its session, membership and roles itself, so a revocation
 * committed a moment earlier still stops it.
 */
export function sharesBurstLookups(): boolean {
  const store = storage.getStore();
  return store !== undefined && !store.writes;
}

/** Whether a read made now would be kept for the rest of the request. */
export function requestReadsActive(): boolean {
  const store = storage.getStore();
  return store !== undefined && !store.sealed;
}

/**
 * Returns the request's earlier result for `key`, or runs `read` and keeps its
 * promise for the rest of the request. Concurrent callers within the request
 * share one in-flight read. A failed read is forgotten, so a later caller in
 * the same request tries again.
 *
 * Each caller gets its own copy (`structuredClone`), so one consumer mutating
 * a row cannot change what another sees.
 */
export async function readOncePerRequest<T>(
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  const store = storage.getStore();
  if (!store || store.sealed) return read();

  const { reads } = store;
  let pending = reads.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = read();
    reads.set(key, pending);
    const settled = pending;
    settled.catch(() => {
      if (reads.get(key) === settled) reads.delete(key);
    });
  }
  return structuredClone(await pending);
}

/**
 * Records `value` as the request's answer for `key`, as if a read had just
 * returned it, unless something already holds that key. For one call that
 * answers several keys' reads at once (`get_request_context`, #3583): each
 * reader then finds its own row. Does nothing outside a request or once the
 * store is sealed, so it never hands a write's handler a row from before its
 * own write.
 */
export function keepForRequest(key: string, value: unknown): void {
  const store = storage.getStore();
  if (!store || store.sealed || store.reads.has(key)) return;
  store.reads.set(key, Promise.resolve(value));
}
