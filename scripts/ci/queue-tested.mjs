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
// `ci.yml`'s `changes` job runs this on a push (only), and writes `tested` to
// `$GITHUB_OUTPUT`. The other CI jobs (all but `packages-build`, which seeds
// main's caches) skip when it is `true`, and `main-caches` seeds the tool
// caches they used to write. Skipped jobs report `skipped`, so the run still
// concludes `success` and Deploy staging still fires on it, and
// `validate-deploy-sha.mjs` judges a production deploy on the queue run's
// check runs, which sit on the same commit (`deployEvidenceByName`).
//
// What counts as "passed": a `merge_group` run of this workflow on this exact
// SHA that either concluded `success`, or whose required CI jobs (`CI_CHECKS`)
// have all finished green. The second arm matters because the queue merges as
// soon as the required checks pass, which can be before the run as a whole is
// completed (the advisory `duplicate-detection` still running, say), and the
// push run's lookup lands seconds after the merge.
//
// Fail-safe in one direction only. Any other event, any API error and any doubt
// is `false`, and `false` runs the full suite, as every push did before. So is
// a re-run (`RUN_ATTEMPT` above 1): whoever re-runs a push run wants a real
// result, and a skip can't replace an earlier attempt's failure as deploy
// evidence (`deployEvidenceByName`), so a re-run that skipped would leave that
// commit undeployable. A commit that reached `main` without the queue (an admin
// bypass, a bot's direct push) has no queue run and is tested in full. The
// script never exits non-zero: a failure here must cost minutes, never a red
// `changes` check.
//
// Unit tests: scripts/ci/__tests__/queue-tested.test.mjs.

import { appendFileSync } from "node:fs";

import { ACCEPTED_CONCLUSIONS } from "./lib/check-runs.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { CI_CHECKS } from "./lib/required-checks.mjs";

/** The workflow file whose queue runs count. A rename reads as "not tested". */
export const CI_WORKFLOW_FILE = "ci.yml";

const SHA = /^[0-9a-f]{40}$/;

/** A short, readable form of an API error body for the log line. */
function describe(data) {
  if (data === null || data === undefined || data === "") return "";
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return `: ${text.slice(0, 200)}`;
}

/** Why this run must not skip before any lookup, or null when it may ask. */
function precheck({ eventName, sha, runAttempt }) {
  if (eventName !== "push") return `event is ${eventName || "unknown"}, not push`;
  if (!SHA.test(sha ?? "")) return `'${sha}' is not a full commit SHA`;
  const attempt = Number(runAttempt ?? 1);
  if (!Number.isInteger(attempt) || attempt !== 1) return `this is attempt ${runAttempt} of the run, and a re-run tests in full`;
  return null;
}

/**
 * The queue runs of this commit worth asking about, newest first. Each
 * condition is checked on the run itself rather than trusted to the query
 * string, so a filter the API ignored can't widen what counts.
 */
export function candidateRuns({ sha, runs }) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.head_sha === sha && run?.event === "merge_group")
    .sort((a, b) => Date.parse(b?.created_at ?? 0) - Date.parse(a?.created_at ?? 0));
}

/** A queue run that finished green as a whole. */
export function runSucceeded(run) {
  return run?.status === "completed" && run?.conclusion === "success";
}

/**
 * Every required CI job finished green in this run's latest attempt: what the
 * queue itself waited for before it merged. A required job missing from the
 * list, still running, or not green is a no.
 */
export function requiredJobsPassed(jobs, required = CI_CHECKS) {
  const byName = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (typeof job?.name === "string") byName.set(job.name, job);
  }
  return required.every((name) => {
    const job = byName.get(name);
    return job?.status === "completed" && ACCEPTED_CONCLUSIONS.has(job.conclusion);
  });
}

/** Reads the queue runs for `sha` and decides. Never throws. */
export async function checkQueueTested({ eventName, sha, runAttempt = 1, repo, token, fetchImpl = fetch, retryOptions }) {
  const early = precheck({ eventName, sha, runAttempt });
  if (early) return { tested: false, reason: early };

  const get = (path) => ghRequest({ token, fetchImpl, path, retry: true, retryOptions });
  const listed = await get(
    `/repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs?event=merge_group&head_sha=${sha}&per_page=20`,
  );
  if (!listed.ok || !Array.isArray(listed.data?.workflow_runs)) {
    return {
      tested: false,
      reason: `could not read merge queue runs (HTTP ${listed.status}${describe(listed.data)}); running the full suite`,
    };
  }

  const runs = candidateRuns({ sha, runs: listed.data.workflow_runs });
  const passed = runs.find(runSucceeded);
  if (passed) return { tested: true, reason: `merge queue run ${passed.id} passed CI on ${sha}`, runId: passed.id };

  for (const run of runs) {
    if (run?.status === "completed") continue; // concluded, and not success
    const jobs = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    if (!jobs.ok || !Array.isArray(jobs.data?.jobs)) continue;
    if (requiredJobsPassed(jobs.data.jobs)) {
      return {
        tested: true,
        reason: `every required CI job passed in merge queue run ${run.id} on ${sha} (the run is still finishing its advisory jobs)`,
        runId: run.id,
      };
    }
  }
  return { tested: false, reason: `no merge queue CI run passed on ${sha}; running the full suite` };
}

async function main() {
  const verdict = await checkQueueTested({
    eventName: process.env.EVENT_NAME,
    sha: process.env.HEAD_SHA,
    runAttempt: process.env.RUN_ATTEMPT,
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
