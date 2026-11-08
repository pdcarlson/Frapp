// The check-runs read and the "did this required check pass" rule, shared by
// validate-deploy-sha.mjs (the deploy gate) and pr-base-sync.mjs (the auto-merge
// update slot, #3599), so the two can't disagree about what green means.
//
// Dependency-free apart from ./github.mjs: pr-base-sync.mjs holds the base-sync
// App token and must shell out nowhere, transitively
// (docs/ci-cd/pr-babysitting.md, the security review).

import { ghRequest } from "./github.mjs";

// GitHub counts all three as satisfying a required check, and so does branch
// protection. `skipped` is the load-bearing one: this repo path-gates several
// required jobs with a job-level `if:`, and a job skipped that way reports
// Success (spec/architecture/adr/adr-15.md, amendment 2026-08-19).
export const ACCEPTED_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

const CHECK_RUNS_PATH = (repo, sha, page) =>
  `/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`;

function startedAt(run) {
  const value = run?.started_at ?? run?.completed_at;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The newest run of each check name. A re-run creates a second check run with
 * the same name, so the most recently started wins; taking "any run succeeded"
 * instead would let a green first attempt mask a red re-run.
 */
export function latestRunsByName(checkRuns) {
  const latestByName = new Map();
  for (const run of Array.isArray(checkRuns) ? checkRuns : []) {
    const name = run?.name;
    if (typeof name !== "string" || name === "") continue;
    const previous = latestByName.get(name);
    if (!previous || startedAt(run) >= startedAt(previous)) {
      latestByName.set(name, run);
    }
  }
  return latestByName;
}

/**
 * Every check run recorded against `sha`, following pagination.
 *
 * Paginated rather than a single 100-item page because this repo emits well
 * over 20 check runs per commit today and the required list is ~20 of them; a
 * truncated page would silently classify the overflow as `missing`, turning a
 * green commit into a refused deploy (and, if the defaults were ever inverted,
 * the reverse).
 *
 * Each page retries through `ghRequest`'s own `retry`, which gives every
 * attempt its own timeout. Passing `resilientFetch` as `fetchImpl` instead
 * would nest two retry loops, and since #2333 `ghRequest` bounds every call
 * itself, the inner loop's attempts would all share one 15s deadline: one
 * stalled page would refuse a green commit. `retryOptions` keeps tests offline.
 */
export async function fetchCheckRuns({ repo, sha, token, fetchImpl = fetch, maxPages = 10, retryOptions }) {
  const runs = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await ghRequest({
      token,
      fetchImpl,
      path: CHECK_RUNS_PATH(repo, sha, page),
      retry: true,
      retryOptions,
    });
    if (!result.ok) {
      const detail = result.data ? `: ${result.data}` : "";
      throw new Error(`GitHub checks API returned HTTP ${result.status} for ${sha}${detail}`);
    }
    // A 2xx with an unparseable body (a proxy/CDN error page, say) leaves
    // `result.data` as the raw response text rather than an object, so
    // `.check_runs` reads `undefined`. Falling back to `[]` there would read
    // as "this commit has zero check runs" — a false, definitive FAILURE
    // verdict downstream — instead of the honest "could not read CI status"
    // a malformed response deserves.
    if (!Array.isArray(result.data?.check_runs)) {
      throw new Error(`GitHub checks API returned an unexpected payload for ${sha} (page ${page})`);
    }
    const batch = result.data.check_runs;
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs;
}

