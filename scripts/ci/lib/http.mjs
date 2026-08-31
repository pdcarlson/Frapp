// Bounded retry and a fetch timeout, for the scripts on the production deploy
// path.
//
// Before this module the whole `scripts/` tree carried exactly ONE fetch
// timeout (`staging-conformance.mjs`, `AbortSignal.timeout`) and TWO bounded
// retries (`check-migration-drift-gate.mjs`, `pr-base-sync.mjs`). None of the
// eight scripts `deploy-production.yml` invokes had either, so a single
// transient 5xx — or a socket that simply never answers — threw mid-deploy.
// The four provider-facing ones poll, but a poll is not a retry: it re-asks a
// question that was answered, it does not re-send a request that failed.
//
// ── What is retried, and what is not ────────────────────────────────────────
// Retriable: 429, any 5xx, and a network-level throw (undici rejects on DNS
// failure and ECONNRESET rather than returning a response), plus our own
// timeout. Each of those is a statement about the transport, not the request.
//
// NOT retriable: every other 4xx. A 401, 403 or 404 on a deploy path means a
// dead token or a wrong id, and re-sending it three times converts a clear
// failure into a slow one. The caller sees the response and decides.
//
// A caller-supplied `signal` that aborts is never retried either — that is
// somebody deliberately cancelling, and honouring it is the whole point.

/** Long enough for a slow provider API, short enough to fail inside a job. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Three attempts over ~6s: absorbs blips, surfaces outages as outages. */
export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = [1000, 5000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 and 5xx are transport statements; other 4xx are about the request. */
export function isRetriableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Methods a failed request may be re-sent for.
 *
 * This is the sharpest edge in this module. `deploy-render-production.mjs` and
 * `deploy-vercel-production.mjs` both POST to *create a deployment*, and a
 * create is not idempotent: if the first POST reached the provider and only its
 * response was lost — a gateway 502, or our own timeout firing on a slow but
 * successful call — then retrying it starts a SECOND production deploy. A retry
 * helper that made the production path less safe than it found it would defeat
 * the point of adding one.
 *
 * So retry is scoped to the methods where re-sending cannot duplicate an
 * effect. Everything else still gets the timeout, which is pure benefit: it
 * converts a hung socket into a prompt, legible failure instead of a job that
 * sits until the runner kills it.
 *
 * A caller that knows its POST is idempotent (a search, a dry-run) opts in with
 * `retryMethods`.
 */
export const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `fetch` with a timeout and a bounded retry.
 *
 * Returns the final `Response` — including a non-ok one, which the caller still
 * inspects. Throws only when every attempt threw, and then it rethrows the last
 * error rather than inventing one, so the original cause survives to the log.
 */
export async function fetchWithRetry(
  url,
  init = {},
  {
    attempts = DEFAULT_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    sleep = defaultSleep,
    onRetry,
    retryMethods = IDEMPOTENT_METHODS,
  } = {},
) {
  let lastError = null;

  // A non-idempotent request gets the timeout but exactly one attempt.
  const method = (init.method ?? "GET").toUpperCase();
  const effectiveAttempts = retryMethods.has(method) ? attempts : 1;

  for (let attempt = 1; attempt <= effectiveAttempts; attempt += 1) {
    // Only install our timeout when the caller has not brought a signal of
    // their own. Racing two signals needs `AbortSignal.any`, and the caller's
    // intent should win over a default anyway.
    const signal =
      init.signal ??
      (timeoutMs > 0 && typeof AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined);

    let response = null;
    try {
      response = await fetchImpl(url, signal ? { ...init, signal } : init);
      lastError = null;
    } catch (error) {
      // The caller cancelled: their decision, not a transport blip.
      if (init.signal?.aborted) throw error;
      lastError = error;
    }

    if (response && !isRetriableStatus(response.status)) return response;

    const isLast = attempt === effectiveAttempts;
    if (isLast) {
      if (response) return response;
      throw lastError;
    }

    onRetry?.({
      attempt,
      status: response?.status ?? null,
      error: lastError,
      url,
    });
    await sleep(backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 1000);
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw lastError ?? new Error(`fetchWithRetry exhausted attempts for ${url}`);
}

/**
 * A drop-in replacement for `fetch` carrying the defaults above.
 *
 * Every script on the production deploy path already took its fetch as an
 * injectable `fetchImpl = fetch` parameter, so swapping that default is the
 * whole cutover: production picks up the timeout and the method-scoped retry,
 * and every test that injects its own double is untouched by construction.
 */
export const resilientFetch = (url, init) => fetchWithRetry(url, init);
