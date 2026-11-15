#!/usr/bin/env node

// Did the merge queue already pass CI on this exact commit? (#5084)
//
// The merge queue (#4795) builds a test commit from `main` plus the PRs ahead
// of it, runs every CI job on it in full, and then fast-forwards `main` to
// that same commit. The `push` run CI then starts on `main` tests a tree the
// queue has already passed, so it is the third full run of 22 jobs for one
// merge, all of them competing for the account's concurrent-job cap. On
// 2026-11-15 that cap kept jobs waiting 1 to 15 minutes for a runner and
// stretched queue entries to 15 to 24 minutes.
//
// `ci.yml`'s `changes` job runs this on every event and writes `tested` to
// `$GITHUB_OUTPUT`. The other CI jobs (all but `packages-build`, which seeds
// main's caches) skip when it is `true`. Skipped jobs report `skipped`, so the
// run still concludes `success` and Deploy staging still fires on it, and
// `validate-deploy-sha.mjs` judges a production deploy on the queue run's
// check runs, which sit on the same commit (`deployEvidenceByName`).
//
// Fail-safe in one direction only: `true` needs a completed, successful
// `merge_group` run of this workflow whose head is this exact SHA. Any other
// event, any API error and any doubt is `false`, and `false` runs the full
// suite, as every push did before. A commit that reached `main` without the
// queue (an admin bypass, a bot's direct push) has no such run and is tested
// in full. The script never exits non-zero: a failure here must cost minutes,
// never a red `changes` check.
//
// Unit tests: scripts/ci/__tests__/queue-tested.test.mjs.

import { appendFileSync } from "node:fs";

import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/** The workflow file whose queue runs count. A rename reads as "not tested". */
export const CI_WORKFLOW_FILE = "ci.yml";

const SHA = /^[0-9a-f]{40}$/;

/** A short, readable form of an API error body for the log line. */
function describe(data) {
  if (data === null || data === undefined || data === "") return "";
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return `: ${text.slice(0, 200)}`;
}

/**
 * Pure verdict over the workflow runs the API returned.
 *
 * Each condition is checked on the run itself rather than trusted to the query
 * string, so a filter the API ignored (or a mocked response in a test) can't
 * widen what counts: the same commit, the queue's event, finished, green.
 */
export function queueTested({ eventName, sha, runs }) {
  if (eventName !== "push") return { tested: false, reason: `event is ${eventName || "unknown"}, not push` };
  if (!SHA.test(sha ?? "")) return { tested: false, reason: `'${sha}' is not a full commit SHA` };
  const match = (Array.isArray(runs) ? runs : []).find(
    (run) =>
      run?.head_sha === sha &&
      run?.event === "merge_group" &&
      run?.status === "completed" &&
      run?.conclusion === "success",
  );
  return match
    ? { tested: true, reason: `merge queue run ${match.id} passed CI on ${sha}`, runId: match.id }
    : { tested: false, reason: `no successful merge queue CI run for ${sha}` };
}

/** Reads the queue runs for `sha` and returns `queueTested`'s verdict. Never throws. */
export async function checkQueueTested({ eventName, sha, repo, token, fetchImpl = fetch, retryOptions }) {
  if (eventName !== "push" || !SHA.test(sha ?? "")) return queueTested({ eventName, sha, runs: [] });
  const result = await ghRequest({
    token,
    fetchImpl,
    path:
      `/repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs` +
      `?event=merge_group&head_sha=${sha}&status=success&per_page=20`,
    retry: true,
    retryOptions,
  });
  if (!result.ok || !Array.isArray(result.data?.workflow_runs)) {
    return {
      tested: false,
      reason: `could not read merge queue runs (HTTP ${result.status}${describe(result.data)}); running the full suite`,
    };
  }
  return queueTested({ eventName, sha, runs: result.data.workflow_runs });
}

async function main() {
  const verdict = await checkQueueTested({
    eventName: process.env.EVENT_NAME,
    sha: process.env.HEAD_SHA,
    repo: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(`${verdict.tested ? "Skipping" : "Running"} the CI jobs: ${verdict.reason}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tested=${verdict.tested}\n`);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    // Still exit 0 with no output: an unset `tested` reads as not tested.
    console.log(`::warning::queue-tested: ${error.message}; running the full suite.`);
  });
}
