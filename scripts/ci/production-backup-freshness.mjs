#!/usr/bin/env node

// Scheduled watch: the nightly production Postgres dump must keep succeeding.
//
// Launch bar 2 needs a recoverable production dump. Nightly Backup
// (`db-backup.yml`) has been green, but nothing fails closed if
// `backup-production` stops, skips, hangs, or ages out. The reviewer watch
// (1956) only sees GitHub environment `production-backup`. A dump that never
// starts, or a job that concludes anything other than success, would leave
// recoverability looking covered.
//
// This script GETs recent `db-backup.yml` runs and their jobs and judges
// `backup-production` by the rules in `lib/backup-job-freshness.mjs` (shared with
// the Storage watch; that header is the canonical statement, so it
// isn't restated here).
//
// It does not name any GitHub `environment:` itself. A schedule job that
// named `production` would hang on the ADR-19 reviewer gate (#1435). It
// never PUTs an environment, a workflow, or a dump.
//
// Own alert title. A recovered pin, uptime, or backup-env run must not
// close this. The hosted restore leftover stays on its own issue (1861).
//
// Semantics: `lib/backup-job-freshness.mjs`. Tests: its own suite, and
// `scripts/ci/__tests__/production-backup-freshness.test.mjs` for this watch.

import {
  defineAlert,
  raiseAlert,
  resolveAlert,
} from "./lib/alert-issue.mjs";
import {
  RUNS_PER_PAGE,
  readJobFreshness,
  verdictLogLine,
} from "./lib/backup-job-freshness.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const WORKFLOW_FILE = "db-backup.yml";
export const DEFAULT_BRANCH = "main";
export const PRODUCTION_JOB_NAME = "backup-production";
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const HUNG_AFTER_MS = 3 * 60 * 60 * 1000;
// The job's `timeout-minutes` in db-backup.yml. GitHub reports a job its
// timeout stopped as `cancelled`; this is how the verdict tells that from a
// cancelled dispatch. The test suite checks it against the workflow.
export const JOB_TIMEOUT_MS = 30 * 60 * 1000;

export const ALERT = defineAlert({
  title: "Nightly production dump is stale or failed — recoverability is unproven",
  labels: ["area:ci", "P1"],
});

/** Prefer the job token: Actions reads work with GITHUB_TOKEN. */
export function resolveActionsReadToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GITHUB_PAT || "";
}

/** Actions job-scoped `issues: write` is on GITHUB_TOKEN. */
export function resolveAlertToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GITHUB_PAT || "";
}

export function resolveActionsFallbackToken(env = process.env) {
  const primary = resolveActionsReadToken(env);
  if (env.GITHUB_PAT && env.GITHUB_PAT !== primary) return env.GITHUB_PAT;
  return "";
}

function isAuthish(status) {
  return status === 401 || status === 403;
}

async function ghGetWithFallback({ token, fallbackToken, fetchImpl, path }) {
  const first = await ghRequest({ token, fetchImpl, path });
  if (
    isAuthish(first.status) &&
    typeof fallbackToken === "string" &&
    fallbackToken &&
    fallbackToken !== token
  ) {
    return ghRequest({ token: fallbackToken, fetchImpl, path });
  }
  return first;
}

function runsPath(repo) {
  return (
    `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs` +
    `?branch=${encodeURIComponent(DEFAULT_BRANCH)}&per_page=${RUNS_PER_PAGE}`
  );
}

function jobsPath(repo, runId) {
  return `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`;
}

/**
 * GET recent Nightly Backup runs on `main` and their jobs, as
 * `readJobFreshness` in `lib/backup-job-freshness.mjs` describes.
 * A feature-branch dispatch is not the production dump. Schedule and
 * workflow_dispatch on `main` both count: a failed dump on `main` is a
 * failed dump. Retry with the fallback token only on 401/403, and only
 * when the fallback token is different. Never PUT.
 */
export async function readDumpFreshness({
  token,
  repo,
  fetchImpl,
  fallbackToken,
  now = Date.now(),
}) {
  return readJobFreshness({
    jobName: PRODUCTION_JOB_NAME,
    workflowFile: WORKFLOW_FILE,
    staleAfterMs: STALE_AFTER_MS,
    hungAfterMs: HUNG_AFTER_MS,
    timeoutMs: JOB_TIMEOUT_MS,
    runsPath: runsPath(repo),
    jobsPath: (runId) => jobsPath(repo, runId),
    get: (path) => ghGetWithFallback({ token, fallbackToken, fetchImpl, path }),
    now,
  });
}

function buildAlertIssueBody({ verdict, runUrl }) {
  return [
    "The nightly production Postgres dump is missing, failed, hung, or older than 36 hours.",
    "",
    `**${verdict.reason}**`,
    "",
    "Launch bar 2 needs a recoverable production dump. Nightly Backup (`db-backup.yml`) `backup-production` is the only copy of `frapp-prod` outside Supabase: Supabase's own daily backups (7 days, Pro) are deleted with the project and hold no Storage files. The reviewer watch (1956) only sees GitHub environment `production-backup`. The hosted restore leftover stays on its own issue (1861).",
    "",
    "Do not change the dump cron to clear a red run. Inspect the latest `backup-production` job and recover the dump, then wait for a later freshness run.",
    "",
    runUrl ? `Run: ${runUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runWatchdog({
  verdict,
  token,
  repo,
  runUrl = "",
  fetchImpl,
}) {
  if (!verdict.ok) {
    const raised = await raiseAlert({
      token,
      repo,
      fetchImpl,
      alert: ALERT,
      buildIssueBody: () => buildAlertIssueBody({ verdict, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still stale or failed: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised };
  }

  if (!verdict.fresh) {
    return { outcome: "pass", resolved: false, pending: true };
  }

  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    alert: ALERT,
    buildRecoveryBody: () =>
      `Nightly production dump is fresh again: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  // A clean run that cannot read or close its alert is red. One failed read is
  // usually transient, but a lasting one means the job's token lost issues
  // access, and then the next real failure cannot raise its alert either; this
  // daily run is the only early signal of that. A close that left the alert
  // open is red too: a green run would hide a P1 open on a healthy system.
  if (resolved.action === "unread") {
    return { outcome: "fail", resolved: false, lookupOk: false };
  }
  return {
    outcome: resolved.action === "failed" ? "fail" : "pass",
    resolved: resolved.action === "closed",
    lookupOk: true,
  };
}

async function main() {
  const probeOnly = process.argv.includes("--probe-only");

  const actionsToken = resolveActionsReadToken();
  if (!actionsToken) {
    const message = "GITHUB_TOKEN or GITHUB_PAT is required.";
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`);
    process.exit(1);
  }
  const repo = requireEnv("GITHUB_REPOSITORY");

  const fallbackToken = resolveActionsFallbackToken();
  const verdict = await readDumpFreshness({
    token: actionsToken,
    repo,
    fallbackToken,
  });
  // A pass resting on an earlier success prints as a warning, not green.
  (verdict.ok ? console.log : console.error)(verdictLogLine(verdict));

  if (probeOnly) {
    process.exit(verdict.ok ? 0 : 1);
  }

  const alertToken = resolveAlertToken();
  if (!alertToken) {
    console.error("::error::GITHUB_TOKEN or GITHUB_PAT is required to write the alert");
    process.exit(1);
  }

  const runUrl = process.env.RUN_URL ?? "";
  const watchdog = await runWatchdog({
    verdict,
    token: alertToken,
    repo,
    runUrl,
  });
  if (!verdict.ok && watchdog.alert?.action === "failed") {
    console.error("::error::the nightly dump is stale or failed and the alert issue could not be written");
  }
  if (verdict.fresh && watchdog.lookupOk === false) {
    console.error("::error::Could not read the alert issues, so no alert was closed this run");
  } else if (verdict.fresh && watchdog.outcome === "fail") {
    console.error("::error::the nightly dump is fresh but the alert issue could not be closed");
  }
  process.exit(watchdog.outcome === "pass" ? 0 : 1);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
