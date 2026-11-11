import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * One read per request for the lookups every chat request repeats (#3728).
 *
 * A request's guards read the caller's membership and roles, and the handler's
 * access checks (`ChannelAccessService`, `RbacService`) then read the same
 * rows again, two or three times on a channel list, one after another. On a
 * resume burst every one of those is a round trip to Supabase. Inside one
 * request they now share the first read, and the guards' reads start while
 * the session check is still in flight (`prefetchChapterContext`).
 *
 * **Never across requests.** `spec/behavior/rbac.md` § Permission Resolution
 * and `spec/behavior/multi-tenancy.md` promise that each request resolves
 * membership and roles afresh, and Paul kept that promise in #3752. The store
 * is created per request by `requestReadsMiddleware` and dies with it, so a
 * role change or a removal still takes effect on the very next request.
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
