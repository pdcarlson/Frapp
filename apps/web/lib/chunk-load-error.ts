/**
 * Is this the render error that a reload fixes and a retry cannot?
 *
 * #2145 put the first three `next/dynamic` boundaries in `apps/web`, which
 * bought a measured 51.6 KB off the shell floor and, with it, a failure mode
 * the app did not have before: a chunk emitted by an older build is not on the
 * CDN after the hash rotates, so the import rejects at the moment a member
 * clicks the control. `next/dynamic` is `React.lazy` + Suspense, and Suspense
 * catches *suspension*, not *rejection*, so the rejection throws to the nearest
 * error boundary (#2175).
 *
 * ## Why this distinction earns a module rather than an inline `===`
 *
 * Because the two remedies are not interchangeable, and the wrong one is a
 * button that cannot work. Next's `retry()` re-renders the boundary's children
 * after a `router.refresh()` (`next/dist/client/components/catch-error.js`) —
 * but the thing it re-renders is a `React.lazy` payload, and `React.lazy`
 * memoises its outcome permanently. `lazyInitializer`
 * (`react/cjs/react.development.js`) calls the loader only while
 * `payload._status === -1`; a rejection sets `_status = 2` and `_result = error`
 * once, and every later render ends at the function's last line, `throw
 * payload._result`. The loader is never invoked a second time.
 *
 * `next/dynamic` holds one such payload per `dynamic()` call, in a module-level
 * binding, so it lives as long as the document does. Retry therefore re-throws
 * the *cached* error instantly, as many times as it is pressed, and only a
 * reload builds a fresh payload against a fresh build manifest. That is the
 * whole asymmetry: a stale chunk wants Reload, every other render error wants
 * Retry.
 *
 * Worth knowing before assuming a retry was simply never attempted: the
 * Turbopack runtime already makes one of its own, and it is narrower than it
 * looks. In the emitted runtime the load-failure handler retries a single time
 * behind a ~200-600ms delay, but only for a null error or a `DOMException`
 * named `NetworkError`; anything else — a 404 on a rotated hash, which is this
 * module's case — falls to the other branch, which deletes the URL's resolver
 * and rejects. So by the time a `ChunkLoadError` reaches React, the transient
 * case has already been retried and ruled out, and what is left is the case a
 * retry does not fix.
 *
 * ## Why `name` is the check, and why it is reliable here
 *
 * `ChunkLoadError` is webpack's name for this, and it would be fair to assume
 * it does not survive Next 16's move to Turbopack. It does, deliberately: the
 * Turbopack browser runtime builds the error and then assigns the webpack name
 * onto it —
 *
 *     let error = Error(`Failed to load chunk ${chunkUrl} ${loadReason}...`)
 *     throw error.name = "ChunkLoadError", error
 *
 * — which is verifiable in this repo's own output rather than only in the
 * vendored source: `apps/web/.next/static/chunks/turbopack-*.js` after
 * `npm run build -w apps/web` contains that assignment. The name is set on a
 * plain `Error` thrown in the browser, so it reaches a client error boundary
 * intact; Next only redacts errors forwarded from *Server* Components, and a
 * rejected client-side `import()` is not one.
 *
 * The message check is the belt to that suspenders. A native ESM `import()`
 * that 404s rejects with a `TypeError` the browser words itself ("Failed to
 * fetch dynamically imported module"), with no name to match, and that is the
 * shape any future bundler change would most likely produce. Matching it costs
 * nothing and fails safe in the direction that matters: a false positive offers
 * Reload where Retry would also have worked, while a false negative offers the
 * one button this module exists to prove cannot succeed.
 *
 * `cause` is walked for the same reason — the Turbopack runtime attaches the
 * underlying failure as `cause` when it has one, and a wrapper added upstream
 * would otherwise hide the signal one level down. The walk is depth-capped
 * because `cause` chains are attacker-free but not cycle-free.
 */
const CHUNK_LOAD_ERROR_NAME = "ChunkLoadError";

const CHUNK_LOAD_MESSAGES = [
  // Turbopack and webpack, respectively. Both are matched on message as well
  // as name so a stripped `name` still classifies.
  "failed to load chunk",
  "loading chunk",
  // Native ESM, worded by the browser rather than the bundler.
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  // Safari's spelling of the same condition.
  "importing a module script failed",
];

/** Deep enough for a wrapper or two, shallow enough to never be the problem. */
const MAX_CAUSE_DEPTH = 4;

export function isChunkLoadError(error: unknown): boolean {
  for (let depth = 0, current = error; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return false;

    const { name, message, cause } = current as {
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };

    if (name === CHUNK_LOAD_ERROR_NAME) return true;

    if (typeof message === "string") {
      const haystack = message.toLowerCase();
      if (CHUNK_LOAD_MESSAGES.some((needle) => haystack.includes(needle))) {
        return true;
      }
    }

    if (cause === undefined || cause === current) return false;
    current = cause;
  }

  return false;
}
