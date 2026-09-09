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
// This script GETs recent `db-backup.yml` runs and their jobs. It fails if
// `backup-production` is missing, not success, hung more than 3h, or last
// success older than 36h. In-flight under 3h is pass. Unreadable Actions
// responses are FAIL, not pass.
//
// It does not name any GitHub `environment:` itself. A schedule job that
// named `production` would hang on the ADR-19 reviewer gate (#1435). It
// never PUTs an environment, a workflow, or a dump.
//
// Own alert title. A recovered pin, uptime, or backup-env run must not
// close this. The hosted restore leftover stays on its own issue (1861).
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/production-backup-freshness.test.mjs`.

import { findAlertIssuesDetailed, raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";
import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";

export const WORKFLOW_FILE = "db-backup.yml";
export const PRODUCTION_JOB_NAME = "backup-production";
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const HUNG_AFTER_MS = 3 * 60 * 60 * 1000;

export const ALERT_ISSUE_TITLE =
  "Nightly production dump is stale or failed — recoverability is unproven";
export const ALERT_ISSUE_LOOKUP_LABEL = "routine-state";
export const ALERT_ISSUE_LABELS = [ALERT_ISSUE_LOOKUP_LABEL, "area:ci", "P1"];

const IN_FLIGHT_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

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

function newestRun(runs) {
  return [...runs].sort(
    (a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0),
  )[0];
}

function ageMs(iso, now) {
  const at = Date.parse(iso ?? "");
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : now - at;
}

/**
 * Classify one already-fetched Nightly Backup run + its jobs.
 * `now` is injected so the 36h / 3h windows are deterministic in tests.
 */
export function evaluateDumpFreshness({
  runsStatus,
  runs,
  jobsStatus,
  jobs,
  now,
}) {
  if (runsStatus !== 200 || !Array.isArray(runs)) {
    return {
      ok: false,
      reason: `db-backup.yml runs unreadable (HTTP ${runsStatus || "no response"})`,
    };
  }
  if (runs.length === 0) {
    return { ok: false, reason: "no db-backup.yml runs found" };
  }

  const run = newestRun(runs);
  if (jobsStatus !== 200 || !Array.isArray(jobs)) {
    return {
      ok: false,
      reason: `backup-production jobs unreadable (HTTP ${jobsStatus || "no response"})`,
    };
  }

  const job = jobs.find((entry) => entry && entry.name === PRODUCTION_JOB_NAME);
  if (!job) {
    if (IN_FLIGHT_STATUSES.has(run.status)) {
      if (ageMs(run.run_started_at || run.created_at, now) > HUNG_AFTER_MS) {
        return { ok: false, reason: "backup-production hung for more than 3h" };
      }
      return { ok: true, reason: "backup-production is in flight" };
    }
    return { ok: false, reason: "backup-production job is missing" };
  }

  if (IN_FLIGHT_STATUSES.has(job.status)) {
    if (ageMs(job.started_at || run.created_at, now) > HUNG_AFTER_MS) {
      return { ok: false, reason: "backup-production hung for more than 3h" };
    }
    return { ok: true, reason: "backup-production is in flight" };
  }

  if (job.conclusion !== "success") {
    return {
      ok: false,
      reason: `backup-production concluded ${job.conclusion || "unknown"}`,
    };
  }

  if (ageMs(job.completed_at, now) > STALE_AFTER_MS) {
    return { ok: false, reason: "last backup-production success is older than 36h" };
  }

  return { ok: true, reason: "backup-production succeeded within 36h" };
}

function runsPath(repo) {
  return `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`;
}

function jobsPath(repo, runId) {
  return `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`;
}

/**
 * GET recent Nightly Backup runs, then the newest run's jobs.
 * Retry with the fallback token only on 401/403, and only when the
 * fallback token is different. Never PUT.
 */
export async function readDumpFreshness({
  token,
  repo,
  fetchImpl,
  fallbackToken,
  now = Date.now(),
}) {
  const listed = await ghGetWithFallback({
    token,
    fallbackToken,
    fetchImpl,
    path: runsPath(repo),
  });
  const runs = listed.data?.workflow_runs;
  if (listed.status !== 200 || !Array.isArray(runs) || runs.length === 0) {
    return evaluateDumpFreshness({
      runsStatus: listed.status,
      runs: Array.isArray(runs) ? runs : null,
      jobsStatus: 0,
      jobs: null,
      now,
    });
  }

  const run = newestRun(runs);
  const fetched = await ghGetWithFallback({
    token,
    fallbackToken,
    fetchImpl,
    path: jobsPath(repo, run.id),
  });
  return evaluateDumpFreshness({
    runsStatus: listed.status,
    runs,
    jobsStatus: fetched.status,
    jobs: fetched.data?.jobs,
    now,
  });
}

function buildAlertIssueBody({ verdict, runUrl }) {
  return [
    "The nightly production Postgres dump is missing, failed, hung, or older than 36 hours.",
    "",
    `**${verdict.reason}**`,
    "",
    "Launch bar 2 needs a recoverable production dump. Nightly Backup (`db-backup.yml`) `backup-production` is the only restorable copy of `frapp-prod` until a hosted restore is rehearsed. The reviewer watch (1956) only sees GitHub environment `production-backup`. The hosted restore leftover stays on its own issue (1861).",
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
  const lookup = await findAlertIssuesDetailed({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
  });
  const open = lookup.lookupOk
    ? lookup.issues.find((issue) => issue.state === "open")
    : null;

  if (!verdict.ok) {
    const raised = await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_ISSUE_TITLE,
      labels: ALERT_ISSUE_LABELS,
      lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
      buildIssueBody: () => buildAlertIssueBody({ verdict, runUrl }),
      buildCommentBody: ({ reopened }) =>
        `${reopened ? "Reopened — " : ""}still stale or failed: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
      refreshBodyOnRaise: true,
    });
    return { outcome: "fail", alert: raised, lookupOk: lookup.lookupOk, open };
  }

  if (!lookup.lookupOk) {
    return { outcome: "pass", resolved: false, lookupOk: false };
  }

  const hadOpen = lookup.issues.some((issue) => issue.state === "open");
  const resolved = await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_ISSUE_TITLE,
    lookupLabel: ALERT_ISSUE_LOOKUP_LABEL,
    buildRecoveryBody: () =>
      `Nightly production dump is fresh again: ${verdict.reason}${runUrl ? `\n\nRun: ${runUrl}` : ""}`,
  });
  if (resolved.action === "failed") {
    return { outcome: "fail", resolved: false, lookupOk: true };
  }
  if (hadOpen && resolved.action === "none") {
    return { outcome: "fail", resolved: false, lookupOk: true };
  }
  return {
    outcome: "pass",
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
  if (verdict.ok) {
    console.log(`✅ ${verdict.reason}`);
  } else {
    console.error(`::error::${verdict.reason}`);
  }

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
  if (verdict.ok && watchdog.lookupOk === false) {
    console.error("::warning::Could not read the alert issues, so no alert was closed this run");
  }
  if (verdict.ok && watchdog.outcome === "fail") {
    console.error("::error::the nightly dump is fresh but the alert issue could not be closed");
  }
  process.exit(watchdog.outcome === "pass" ? 0 : 1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
