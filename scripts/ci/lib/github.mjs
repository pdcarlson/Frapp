// The one GitHub REST client.
//
// Four hand-rolled clients sent the same three headers before this:
// `ci-wake.mjs` (`ghRequest`, the best of them and the one moved here),
// `configure-branch-protection.mjs` (`callGitHubApi`), `resolve-release-bump.mjs`
// (`fetchPrLabels`) and `validate-deploy-sha.mjs` (`fetchCheckRuns`).
// `ci-wake.mjs:274` already carried the comment "same headers as
// configure-branch-protection.mjs" — an acknowledgement of the drift rather
// than a fix for it. All four now call `ghRequest` for the request itself,
// not just its headers; each keeps its own error message and throw-on-failure
// contract at the call site, since the callers disagree on that (`fetchPrLabels`
// skips a /pulls 404 only when GET /issues/{n} confirms a bare issue — #1839 —
// and throws on 403 or an unclassifiable 404, while a fail-safe `{ok:false}`
// is correct for the watchdogs — see below).
//
// It lives in `lib/` and not in `ci-wake.mjs` for a second reason: `lib/alert-issue.mjs`
// imported it from `../ci-wake.mjs`, so a library depended on a script. Moving
// the function inverts that back the right way up.
//
// ── Every request is bounded; retry is OFF by default ───────────────────────
// Every call goes through `fetchWithRetry` from `./http.mjs`, so every call gets
// its timeout (15s for a read, 120s for a write, the ceilings that module
// explains), and the timeout also covers reading the body. Before #2333 a call
// without `retry: true` was a bare `fetchImpl`, and only
// `configure-branch-protection.mjs` passed it, so every watchdog call was
// unbounded. A GitHub API that accepted the connection and never answered held
// the call until undici's own ~300s header timeout, so two such calls used up
// a watchdog's `timeout-minutes: 10`. The runner then cancelled the job
// mid-`raiseAlert`, and a real failure wrote no alert at all.
//
// Retry stays opt-in. The watchdogs (`ci-wake`, `pr-base-sync`) treat
// `ok: false` as a fail-safe skip and their suites assert exact call counts
// against 5xx fixtures — e.g. "exactly one API call: the freshness check".
// Retrying by default would change those counts, so without `retry` a call
// makes exactly one attempt, as it always did. Callers that want resilience opt
// in with `retry: true`. Never pass `resilientFetch` as `fetchImpl`: this
// client's own deadline would then cover all of its attempts, and a stall on
// the first would end the lot (validate-deploy-sha did this until #2333).

import { fetchWithRetry } from "./http.mjs";

export const GITHUB_API = "https://api.github.com";

/** The three headers every caller was already sending. */
export function githubHeaders({ token, hasBody = false } = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * A thrown transport error as one line: its message, plus the `cause` undici
 * hangs the real diagnosis on (and that cause's `code`, where it has one).
 */
function describeThrown(error) {
  // Non-Error throws keep the exact prior behaviour (`error?.message ?? null`).
  // Widening that to String(error) would have changed a standing assertion in
  // github.test.mjs, which is not something to do as a side effect of adding
  // cause-folding.
  if (!(error instanceof Error)) return error?.message ?? null;
  const cause = error.cause;
  if (!cause) return error.message;
  const detail =
    cause instanceof Error
      ? `${cause.message}${cause.code ? ` (${cause.code})` : ""}`
      : String(cause);
  return detail ? `${error.message}: ${detail}` : error.message;
}

/**
 * A GitHub REST call that never throws, and never waits past its timeout.
 *
 * Network-level rejections (DNS, ECONNRESET — undici throws, it doesn't return
 * a response) surface as an ordinary failed request, and so does a call or a
 * body read that outlives its timeout. Both watchdogs treat `ok: false` as a
 * fail-safe skip; an uncaught throw instead aborted the WHOLE run — for
 * pr-base-sync that dropped every PR after the failing one and turned a
 * transient socket blip into a red run on main.
 *
 * `retry` opts into the bounded retry in `./http.mjs`. `retryOptions` is passed
 * straight through (attempts, backoff, timeout, sleep) so tests stay offline;
 * its `timeoutMs` applies with or without `retry`.
 */
export async function ghRequest({
  token,
  fetchImpl = fetch,
  method = "GET",
  path,
  body,
  retry = false,
  retryOptions = {},
}) {
  const url = `${GITHUB_API}${path}`;
  const init = {
    method,
    headers: githubHeaders({ token, hasBody: Boolean(body) }),
    body: body ? JSON.stringify(body) : undefined,
  };

  try {
    // One attempt unless the caller opted into retry, but bounded either way.
    const response = await fetchWithRetry(url, init, {
      fetchImpl,
      ...retryOptions,
      ...(retry ? {} : { attempts: 1 }),
    });

    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    // A network-level rejection (DNS, ECONNRESET, an exhausted retry
    // rethrowing) has no HTTP response to carry a message, so the error itself
    // is the only diagnostic left. Putting it in `data` rather than dropping
    // it keeps a throwing caller's error text meaningful — `callGitHubApi`
    // formats `data` straight into its thrown message, and without this a
    // network outage read as the literal string "null", indistinguishable
    // from a server that genuinely returned no body.
    //
    // The `cause` is folded in for the same reason, one level down: undici puts
    // the actual diagnosis there and leaves `message` as the bare, useless
    // "fetch failed". Without it a DNS outage, a TLS/CA-bundle rejection, a
    // proxy reset and a refused connection all reach the operator as the same
    // four words — and `configure-branch-protection.mjs --verify` asks them to
    // tell exactly those apart.
    return { ok: false, status: 0, data: describeThrown(error) };
  }
}

/**
 * A GET that retries on the same token, then is re-sent once with
 * `fallbackToken` when GitHub refuses the first token (401/403) and the
 * fallback is a different token.
 *
 * Both backup-freshness watchdogs read Actions this way, and an unreadable
 * read there is FAIL, so one blip would file a P1 against a healthy backup.
 * That is why both reads retry: a 429, a 5xx, a network error, and a response
 * that doesn't arrive before its timeout. A body that stalls after its headers
 * is not retried (`http.mjs`, #2601). The fallback is only for refusals: a
 * transport failure is the same for any token.
 */
export async function ghGetWithFallback({ token, fallbackToken, fetchImpl, path, retryOptions }) {
  const first = await ghRequest({ token, fetchImpl, path, retry: true, retryOptions });
  const refused = first.status === 401 || first.status === 403;
  if (refused && typeof fallbackToken === "string" && fallbackToken && fallbackToken !== token) {
    return ghRequest({ token: fallbackToken, fetchImpl, path, retry: true, retryOptions });
  }
  return first;
}
