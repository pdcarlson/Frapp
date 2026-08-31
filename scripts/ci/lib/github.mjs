// The one GitHub REST client.
//
// Four hand-rolled clients sent the same three headers before this:
// `ci-wake.mjs` (`ghRequest`, the best of them and the one moved here),
// `configure-branch-protection.mjs` (`callGitHubApi`), `resolve-release-bump.mjs`
// and `validate-deploy-sha.mjs`. `ci-wake.mjs:274` already carried the comment
// "same headers as configure-branch-protection.mjs" — an acknowledgement of the
// drift rather than a fix for it.
//
// It lives in `lib/` and not in `ci-wake.mjs` for a second reason: `lib/alert-issue.mjs`
// imported it from `../ci-wake.mjs`, so a library depended on a script. Moving
// the function inverts that back the right way up.
//
// ── Why retry is OFF by default ─────────────────────────────────────────────
// The watchdogs (`ci-wake`, `pr-base-sync`) treat `ok: false` as a fail-safe
// skip and their suites assert exact call counts against 5xx fixtures — e.g.
// "exactly one API call: the freshness check". Retrying by default would change
// those counts, so the default is byte-identical to the behaviour that moved
// here. Callers that want resilience opt in with `retry: true`; the production
// deploy path uses `fetchWithRetry` from `./http.mjs` directly.

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
 * A GitHub REST call that never throws.
 *
 * Network-level rejections (DNS, ECONNRESET — undici throws, it doesn't return
 * a response) surface as an ordinary failed request. Both watchdogs treat
 * `ok: false` as a fail-safe skip; an uncaught throw instead aborted the WHOLE
 * run — for pr-base-sync that dropped every PR after the failing one and turned
 * a transient socket blip into a red run on main.
 *
 * `retry` opts into the bounded retry in `./http.mjs`; `retryOptions` is passed
 * straight through (attempts, backoff, timeout, sleep) so tests stay offline.
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
    const response = retry
      ? await fetchWithRetry(url, init, { fetchImpl, ...retryOptions })
      : await fetchImpl(url, init);

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
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
